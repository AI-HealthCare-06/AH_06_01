import { z } from "zod";
import type { GameState, QuestId } from "./game";
import { experienceProgress } from "./experience";
import {
  characterStats,
  hydrationPenalty,
  incomingDamage,
  monsterGold,
  monsterStats,
  revivalDelay,
  sleepGoldMultiplier,
  spawnInterval,
  stagePolicies,
  wavePolicies,
} from "./game-policy";

export const questBuffs: { id: QuestId; label: string; stat: string; effect: string }[] = [
  { id: "medicine", label: "ATK", stat: "AD", effect: "공격력 +10%/중첩 · 최대 +30%" },
  { id: "meal", label: "DEF", stat: "DEF", effect: "받는 피해 −20%/중첩 · 최대 −60%" },
  { id: "walk", label: "CRT", stat: "CRT", effect: "6,000보 이후 2,000보마다 +20% · 최대 100%" },
  { id: "water", label: "SPD", stat: "AS", effect: "공격속도 +40%/인정 · 120분 간격 · 최대 +80%" },
  {
    id: "sleep",
    label: "GOLD",
    stat: "GOLD",
    effect: "7시간 +10% · 8시간 이상 +20% · 5시간 미만 감소",
  },
];
export function battleBuffStats(
  game: Pick<
    GameState,
    "experience" | "completed" | "activity" | "steps" | "sleepHours" | "hydrationRatio"
  >,
) {
  const base = characterStats(experienceProgress(game.experience).level);
  const count = (id: QuestId) => game.activity[id] ?? (game.completed.includes(id) ? 1 : 0);
  const adBonus = Math.min(30, count("medicine") * 10) / 100;
  const defBonus = Math.min(60, count("meal") * 20) / 100;
  const asBonus = Math.min(2, count("water")) * 0.4 - hydrationPenalty(game.hydrationRatio);
  const crt = Math.min(1, Math.max(0, Math.floor(((game.steps?.count ?? 0) - 6000) / 2000)) * 0.2);
  const gold = sleepGoldMultiplier(
    game.sleepHours ?? (game.completed.includes("sleep") ? 7 : null),
  );
  return {
    ...base,
    maxHp: base.hp,
    attack: base.ad * (1 + adBonus),
    adBonus,
    defBonus,
    asBonus,
    crt,
    gold,
    attackInterval: 500 / (1 + asBonus),
  };
}
export const combatSchema = z.object({
  stage: z.number().int().min(1).max(5),
  wave: z.number().int().min(1).max(10),
  killed: z.number().int().nonnegative(),
  spawned: z.number().int().nonnegative(),
  spawnIn: z.number().finite(),
  attackIn: z.number().finite(),
  hp: z.number().finite().nonnegative(),
  recovery: z.number().nonnegative(),
  serial: z.number().int().nonnegative(),
  clock: z.number().nonnegative(),
  seed: z.number().int().nonnegative(),
  enemies: z.array(
    z.object({
      id: z.number().int(),
      art: z.number().int().min(0).max(5),
      rank: z.enum(["normal", "elite", "boss"]),
      hp: z.number().finite().nonnegative(),
      maxHp: z.number().positive(),
      ad: z.number().nonnegative(),
      distance: z.number().finite(),
      attackIn: z.number().finite(),
      ranged: z.boolean(),
      hitAt: z.number(),
    }),
  ),
  lastAttack: z
    .object({ time: z.number(), distance: z.number(), damage: z.number(), critical: z.boolean() })
    .nullable(),
  loot: z.object({ time: z.number(), gold: z.number() }).nullable(),
});
export type CombatState = z.infer<typeof combatSchema>;
export function initialCombat(hp = 50): CombatState {
  return {
    stage: 1,
    wave: 1,
    killed: 0,
    spawned: 0,
    spawnIn: 0,
    attackIn: 0,
    hp,
    recovery: 0,
    serial: 0,
    clock: 0,
    seed: 42,
    enemies: [],
    lastAttack: null,
    loot: null,
  };
}
export function waveTarget(wave: number) {
  const policy = wavePolicies[wave - 1];
  return policy.count + (policy.extra ? 1 : 0);
}
export function migrateCombat(defeats: number, level: number) {
  const state = initialCombat(characterStats(level).hp);
  let remaining = defeats;
  while (remaining >= waveTarget(state.wave)) {
    remaining -= waveTarget(state.wave);
    nextWave(state, level);
    if (state.wave === 10 && (state.stage === 5 || level < stagePolicies[state.stage].level)) {
      remaining %= waveTarget(10);
      break;
    }
  }
  state.killed = remaining;
  state.spawned = remaining;
  return state;
}
function nextWave(state: CombatState, level: number) {
  if (state.wave < 10) state.wave++;
  else if (state.stage < 5 && level >= stagePolicies[state.stage].level) {
    state.stage++;
    state.wave = 1;
  }
  state.killed = 0;
  state.spawned = 0;
  state.spawnIn = Math.max(0, state.spawnIn);
}
// Fixed 50ms simulation. Range is checked on every hit. Hit art never stuns.
export function advanceCombat(
  input: CombatState,
  buffs: ReturnType<typeof battleBuffStats>,
  level: number,
  duration: number,
) {
  const state: CombatState = { ...input, enemies: input.enemies.map((enemy) => ({ ...enemy })) };
  let gold = 0;
  let defeats = 0;
  for (let elapsed = 0; elapsed < duration; elapsed += 50) {
    const dt = Math.min(50, duration - elapsed);
    state.clock += dt;
    state.hp = Math.min(state.hp, buffs.maxHp);
    if (state.recovery > 0) {
      state.recovery = Math.max(0, state.recovery - dt);
      if (state.recovery === 0) {
        state.hp = buffs.maxHp;
        state.spawnIn = 0;
      }
      continue;
    }
    state.spawnIn -= dt;
    if (state.spawnIn <= 0 && state.spawned < waveTarget(state.wave)) {
      const policy = wavePolicies[state.wave - 1];
      const rank = state.spawned === policy.count ? policy.extra! : "normal";
      const stats = monsterStats(state.stage, state.wave, rank);
      const art = rank === "boss" ? 5 : rank === "elite" ? 4 : state.serial % 4;
      state.enemies.push({
        id: state.serial++,
        art,
        rank,
        hp: stats.hp,
        maxHp: stats.hp,
        ad: stats.ad,
        distance: 7,
        attackIn: 0,
        ranged: art % 2 === 0,
        hitAt: -1000,
      });
      state.spawned++;
      state.spawnIn += spawnInterval;
    }
    for (const enemy of state.enemies) {
      const range = enemy.ranged ? 2 : 1;
      enemy.distance = Math.max(range, enemy.distance - ((enemy.ranged ? 1.2 : 1.4) * dt) / 1000);
      enemy.attackIn = Math.max(0, enemy.attackIn - dt);
    }
    state.attackIn = Math.max(0, state.attackIn - dt);
    const target = state.enemies
      .filter((enemy) => enemy.distance <= 3)
      .sort((a, b) => a.distance - b.distance || a.id - b.id)[0];
    if (target && state.attackIn === 0) {
      state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
      const critical = state.seed / 4294967296 < buffs.crt;
      const damage = buffs.attack * (critical ? 2 : 1);
      state.lastAttack = { time: state.clock, distance: target.distance, damage, critical };
      target.hp = Math.max(0, target.hp - damage);
      target.hitAt = state.clock;
      target.distance += monsterStats(state.stage, state.wave, target.rank).knockback;
      state.attackIn = buffs.attackInterval;
      if (target.hp === 0) {
        const reward = monsterGold(state.stage, state.wave, target.rank, buffs.gold);
        gold += reward;
        defeats++;
        state.killed++;
        state.loot = { time: state.clock, gold: reward };
        state.enemies = state.enemies.filter((enemy) => enemy.id !== target.id);
      }
    }
    for (const enemy of state.enemies) {
      if (enemy.distance <= (enemy.ranged ? 2 : 1) && enemy.attackIn === 0) {
        state.hp = Math.max(0, state.hp - incomingDamage(enemy.ad, buffs.def, buffs.defBonus));
        enemy.attackIn = 500;
      }
    }
    if (state.hp <= 0) {
      state.recovery = revivalDelay;
      state.enemies = [];
      // Retry the current wave, so an unbeaten Elite cannot stop idle farming.
      state.killed = 0;
      state.spawned = 0;
      state.attackIn = 0;
    } else if (state.killed >= waveTarget(state.wave) && state.enemies.length === 0) {
      nextWave(state, level);
    }
  }
  return { combat: state, gold, defeats };
}
