import {
  enemyAttackRange,
  playerAttackRange,
  selectPlayerTarget,
  meleeContact,
  inPlayerMeleeRange,
} from "./battle-range";
import {
  arena,
  center,
  enemyGeometry,
  playerGeometry,
  playerReleasePosition,
  combatPlayerGeometry,
  projectileGeometry,
  playerProjectileGeometry,
  sweptContact,
  attackEndpoint,
  colliderStopDistance,
} from "./battle-geometry";
import { z } from "zod";
import type { GameState, QuestId } from "./game";
import { experienceProgress, levelUpGold } from "./experience";
import {
  characterStats,
  hydrationPenalty,
  incomingDamage,
  monsterGold,
  monsterStats,
  meleeHpMultiplier,
  revivalDelay,
  sleepGoldMultiplier,
  spawnInterval,
  simultaneousSpawnChance,
  simultaneousSpawnCooldownMultiplier,
  stagePolicies,
  wavePolicies,
  healthOrbDropChance,
  healthOrbRecovery,
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
export type DebugBuffs = Partial<
  Record<"adBonus" | "defBonus" | "asBonus" | "crt" | "gold", number>
>;
export const debugBuffLimits = {
  adBonus: [0, 3],
  defBonus: [0, 0.9],
  asBonus: [-0.8, 3],
  crt: [0, 1],
  gold: [0, 4],
} as const;
export function battleBuffStats(
  game: Pick<
    GameState,
    "experience" | "completed" | "activity" | "steps" | "sleepHours" | "hydrationRatio" | "dinosaur"
  > & { debugBuffs?: DebugBuffs },
) {
  const base = characterStats(experienceProgress(game.experience).level);
  const count = (id: QuestId) => game.activity[id] ?? (game.completed.includes(id) ? 1 : 0);
  const debug = import.meta.env.DEV ? game.debugBuffs : undefined;
  const adBonus = debug?.adBonus ?? Math.min(30, count("medicine") * 10) / 100;
  const defBonus = debug?.defBonus ?? Math.min(60, count("meal") * 20) / 100;
  const asBonus =
    debug?.asBonus ?? Math.min(2, count("water")) * 0.4 - hydrationPenalty(game.hydrationRatio);
  const crt =
    debug?.crt ??
    Math.min(1, Math.max(0, Math.floor(((game.steps?.count ?? 0) - 6000) / 2000)) * 0.2);
  const gold =
    debug?.gold ??
    sleepGoldMultiplier(game.sleepHours ?? (game.completed.includes("sleep") ? 7 : null));
  return {
    ...base,
    dinosaur: game.dinosaur,
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
  pendingGold: z.number().int().nonnegative().default(0),
  stage: z.number().int().min(1).max(5),
  wave: z.number().int().min(1).max(10),
  killed: z.number().int().nonnegative(),
  spawned: z.number().int().nonnegative(),
  spawnIn: z.number().finite(),
  attackIn: z.number().finite(),
  hp: z.number().finite().nonnegative(),
  recovery: z.number().nonnegative(),
  lastFailure: z
    .object({
      stage: z.number().int().min(1).max(5),
      wave: z.number().int().min(1).max(10),
      time: z.number().nonnegative(),
    })
    .nullable()
    .default(null),
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
      attackedAt: z.number().optional(),
    }),
  ),
  projectiles: z
    .array(
      z.object({
        id: z.string(),
        ownerId: z.number().int().nonnegative().optional(),
        art: z.number().int().min(0).max(5),
        rank: z.enum(["normal", "elite", "boss"]).optional(),
        distance: z.number().nonnegative(),
        origin: z.number().positive(),
        damage: z.number().nonnegative(),
      }),
    )
    .default([]),
  healthOrbs: z
    .array(
      z.object({
        id: z.string(),
        time: z.number().nonnegative(),
        x: z.number().finite(),
        y: z.number().finite(),
        fraction: z.union([z.literal(0.1), z.literal(0.2), z.literal(0.4), z.literal(1)]),
        healed: z.number().finite().nonnegative(),
      }),
    )
    .default([]),
  playerProjectiles: z
    .array(
      z.object({
        id: z.string(),
        dinosaur: z.number().int().min(0).max(5),
        x: z.number().finite(),
        y: z.number().finite(),
        vx: z.number().finite(),
        vy: z.number().finite(),
        age: z.number().nonnegative(),
        travelled: z.number().nonnegative(),
        maxTravel: z.number().positive().optional(),
        damage: z.number().nonnegative(),
        critical: z.boolean(),
      }),
    )
    .default([]),
  lastHit: z
    .object({
      time: z.number(),
      x: z.number(),
      y: z.number(),
      damage: z.number(),
      critical: z.boolean(),
    })
    .nullable()
    .default(null),
  transition: z
    .object({
      kind: z.enum(["wave", "stage"]),
      elapsed: z.number().nonnegative(),
      arrived: z.boolean().default(false),
      fromStage: z.number().int().min(1).max(5).optional(),
      fromWave: z.number().int().min(1).max(10).optional(),
    })
    .nullable()
    .default(null),
  lastAttack: z
    .object({
      time: z.number(),
      distance: z.number(),
      damage: z.number(),
      critical: z.boolean(),
      targetId: z.number().optional(),
      art: z.number().optional(),
      ranged: z.boolean().optional(),
      rank: z.enum(["normal", "elite", "boss"]).optional(),
      duration: z.number().positive().optional(),
      impactAt: z.number().nonnegative().optional(),
      resolved: z.boolean().optional(),
      mode: z.enum(["melee", "ranged"]).optional(),
      offsetX: z.number().finite().optional(),
      offsetY: z.number().finite().optional(),
      aimX: z.number().finite().optional(),
      aimY: z.number().finite().optional(),
    })
    .nullable(),
  loot: z.object({ time: z.number(), gold: z.number() }).nullable(),
});
export type CombatState = z.infer<typeof combatSchema>;
export function initialCombat(hp = 50): CombatState {
  return {
    pendingGold: 0,
    stage: 1,
    wave: 1,
    killed: 0,
    spawned: 0,
    spawnIn: 0,
    attackIn: 0,
    hp,
    recovery: 0,
    lastFailure: null,
    serial: 0,
    clock: 0,
    seed: 42,
    enemies: [],
    projectiles: [],
    healthOrbs: [],
    playerProjectiles: [],
    lastHit: null,
    transition: null,
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
  state.spawnIn = 0;
  state.attackIn = 0;
  state.transition = null;
}
export const projectileSpeed = 6; // world units / second (1u = 30 design px)
export const clearDuration = (kind: "wave" | "stage") => (kind === "stage" ? 1600 : 1000);
export const travelDuration = 3000;
export const startDuration = 1000;
export const enemyAttackInterval = (ranged: boolean) => (ranged ? 1000 : 500);
// Saved RNG state makes random groups consistent across offline/reloaded ticks.
function nextRandom(state: CombatState) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
export const playerProjectileSpeed = 240; // design pixels / second
export const meleeDamageMultiplier = 1.15;
export const healthOrbDuration = 900;
export const healthOrbAbsorptionDuration = 400;

export function enemyProjectileOwner(shot: CombatState["projectiles"][number]) {
  // Previously saved shots encode the owner's numeric ID before the dash.
  const legacy = /^(\d+)-\d+$/.exec(shot.id);
  return shot.ownerId ?? (legacy ? Number(legacy[1]) : undefined);
}

// Fixed 50ms simulation; both rendered geometry and swept collisions use this clock.
export function advanceCombat(
  input: CombatState,
  buffs: ReturnType<typeof battleBuffStats>,
  level: number,
  duration: number,
  totalExperience?: number,
  autoRestart = true,
) {
  const state: CombatState = {
    ...input,
    enemies: input.enemies.map((enemy) => ({ ...enemy })),
    projectiles: input.projectiles.map((shot) => ({ ...shot })),
    playerProjectiles: (input.playerProjectiles ?? []).map((shot) => ({ ...shot })),
    healthOrbs: [...(input.healthOrbs ?? [])],
    transition: input.transition ? { ...input.transition } : null,
    lastAttack: input.lastAttack ? { ...input.lastAttack } : null,
  };
  let gold = 0,
    defeats = 0;
  const hitTarget = (target: CombatState["enemies"][number], damage: number, critical: boolean) => {
    if (target.hp <= 0) return;
    const body = enemyGeometry(target.distance, target.art, target.rank, target.ranged).hitbox;
    state.lastHit = { time: state.clock, x: center(body).x, y: body.y - 12, damage, critical };
    target.hp = Math.max(0, target.hp - damage);
    target.hitAt = state.clock;
    target.distance += monsterStats(state.stage, state.wave, target.rank).knockback;
    if (target.hp > 0) return;
    const reward = monsterGold(state.stage, state.wave, target.rank, buffs.gold);
    state.pendingGold += reward;
    defeats++;
    if (totalExperience !== undefined) {
      const before = totalExperience++;
      state.pendingGold += levelUpGold(before, totalExperience);
      const nextLevel = experienceProgress(totalExperience).level;
      if (nextLevel !== level) {
        level = nextLevel;
        const base = characterStats(level);
        buffs = { ...buffs, ...base, maxHp: base.hp, attack: base.ad * (1 + buffs.adBonus) };
      }
    }
    state.killed++;
    state.loot = { time: state.clock, gold: reward };
    state.enemies = state.enemies.filter((enemy) => enemy.id !== target.id);
    state.projectiles = state.projectiles.filter(
      (shot) => enemyProjectileOwner(shot) !== target.id,
    );
    if (nextRandom(state) < healthOrbDropChance) {
      const fraction = healthOrbRecovery(nextRandom(state));
      const healed = Math.max(0, buffs.maxHp - state.hp) * fraction;
      state.hp = Math.min(buffs.maxHp, state.hp + healed);
      state.healthOrbs.push({
        id: `heal-${target.id}-${state.clock}`,
        time: state.clock,
        ...center(body),
        fraction,
        healed,
      });
    }
  };
  for (let elapsed = 0; elapsed < duration; elapsed += 50) {
    const dt = Math.min(50, duration - elapsed);
    const previousPlayer = combatPlayerGeometry(buffs.dinosaur, state.lastAttack, state.clock);
    state.clock += dt;
    state.healthOrbs = state.healthOrbs.filter((orb) => state.clock - orb.time < healthOrbDuration);
    state.hp = Math.min(state.hp, buffs.maxHp);
    if (state.transition) {
      const transition = state.transition;
      transition.elapsed += dt;
      const arrival = clearDuration(transition.kind) + travelDuration;
      if (!transition.arrived && transition.elapsed >= arrival) {
        transition.fromStage ??= state.stage;
        transition.fromWave ??= state.wave;
        nextWave(state, level);
        state.hp = buffs.maxHp;
        transition.arrived = true;
        state.transition = transition;
      }
      if (transition.elapsed >= arrival + startDuration) state.transition = null;
      continue;
    }
    if (state.recovery > 0) {
      if (!autoRestart) {
        state.clock += duration - elapsed - dt;
        break;
      }
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
      const simultaneous = nextRandom(state) < simultaneousSpawnChance;
      const count = Math.min(
        simultaneous ? 2 + Math.floor(nextRandom(state) * 2) : 1,
        waveTarget(state.wave) - state.spawned,
      );
      for (let i = 0; i < count; i++) {
        const rank = state.spawned === policy.count ? policy.extra! : "normal";
        const ranged = rank === "normal" ? nextRandom(state) >= 0.7 : rank === "elite";
        const stats = monsterStats(state.stage, state.wave, rank);
        const hp = ranged ? stats.hp : Math.round(stats.hp * meleeHpMultiplier);
        const art = rank === "boss" ? 5 : rank === "elite" ? 4 : state.serial % 4;
        state.enemies.push({
          id: state.serial++,
          art,
          rank,
          hp,
          maxHp: hp,
          ad: stats.ad * (ranged ? 1 : 1.1),
          // Small horizontal spacing makes a simultaneous group readable.
          distance: 7 + i * 0.45,
          attackIn: 0,
          ranged,
          hitAt: -1000,
        });
        state.spawned++;
      }
      state.spawnIn = spawnInterval * (count > 1 ? simultaneousSpawnCooldownMultiplier : 1);
    }
    const player = combatPlayerGeometry(buffs.dinosaur, state.lastAttack, state.clock);
    const previousEnemies = new Map(
      state.enemies.map((enemy) => [
        enemy.id,
        enemyGeometry(enemy.distance, enemy.art, enemy.rank, enemy.ranged).hitbox,
      ]),
    );
    for (const enemy of state.enemies) {
      const reach = enemyAttackRange(enemy, buffs.dinosaur, player);
      if (enemy.distance > reach)
        enemy.distance = Math.max(reach, enemy.distance - ((enemy.ranged ? 1.2 : 1.4) * dt) / 1000);
      // A melee lunge moves its physical body too; push intersecting bodies to contact.
      enemy.distance = Math.max(
        enemy.distance,
        colliderStopDistance(enemy.art, enemy.rank, buffs.dinosaur, enemy.ranged, player),
      );
      enemy.attackIn = Math.max(0, enemy.attackIn - dt);
    }
    state.playerProjectiles = state.playerProjectiles.filter((shot) => {
      const before = playerProjectileGeometry(shot).hitbox;
      shot.x += (shot.vx * dt) / 1000;
      shot.y += (shot.vy * dt) / 1000;
      shot.age += dt;
      shot.travelled += (playerProjectileSpeed * dt) / 1000;
      const after = playerProjectileGeometry(shot).hitbox;
      let first: { enemy: CombatState["enemies"][number]; time: number } | undefined;
      for (const enemy of state.enemies) {
        const box = enemyGeometry(enemy.distance, enemy.art, enemy.rank, enemy.ranged).hitbox;
        const time = sweptContact(before, after, previousEnemies.get(enemy.id) ?? box, box);
        if (
          time !== null &&
          (!first || time < first.time || (time === first.time && enemy.id < first.enemy.id))
        )
          first = { enemy, time };
      }
      if (first) {
        hitTarget(first.enemy, shot.damage, shot.critical);
        return false;
      }
      return shot.travelled < (shot.maxTravel ?? playerAttackRange * arena.pixelsPerUnit);
    });
    state.attackIn = Math.max(0, state.attackIn - dt);
    const pending = state.lastAttack;
    if (state.hp > 0 && pending?.resolved === false && state.clock >= pending.impactAt!) {
      pending.resolved = true;
      if (pending.mode === "ranged") {
        const source = playerReleasePosition(buffs.dinosaur, player);
        const dx = (pending.aimX ?? source.x + 200) - source.x,
          dy = (pending.aimY ?? source.y) - source.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const shot = {
          id: `p-${state.clock}`,
          dinosaur: buffs.dinosaur,
          ...source,
          vx: (dx / length) * playerProjectileSpeed,
          vy: (dy / length) * playerProjectileSpeed,
          age: 0,
          travelled: 0,
          // Targeting remains 7u; include the distance from the release point through
          // the player's body so a rear-facing release can still reach 7u.
          maxTravel:
            playerAttackRange * arena.pixelsPerUnit +
            Math.max(0, player.hitbox.x + player.hitbox.width - source.x),
          damage: pending.damage,
          critical: pending.critical,
        };
        const box = playerProjectileGeometry(shot).hitbox;
        const touching = state.enemies
          .filter((enemy) => {
            const body = enemyGeometry(enemy.distance, enemy.art, enemy.rank, enemy.ranged).hitbox;
            return sweptContact(box, box, body) !== null;
          })
          .sort((a, b) => a.distance - b.distance || a.id - b.id)[0];
        if (touching) hitTarget(touching, shot.damage, shot.critical);
        else state.playerProjectiles.push(shot);
      } else if (pending.mode === "melee") {
        for (const enemy of [...state.enemies])
          if (inPlayerMeleeRange(enemy, player)) hitTarget(enemy, pending.damage, pending.critical);
      } else {
        // Preserve a saved pre-projectile strike once, then use the new rules.
        const target = state.enemies.find((enemy) => enemy.id === pending.targetId);
        if (target) hitTarget(target, pending.damage, pending.critical);
      }
    }
    // Resolve all player kills before incoming shots, including same-tick contact.
    const livingOwners = new Set(
      state.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => enemy.id),
    );
    state.projectiles = state.projectiles.filter((shot) => {
      const owner = enemyProjectileOwner(shot);
      if (owner === undefined || !livingOwners.has(owner)) return false;
      const before = projectileGeometry(shot, buffs.dinosaur).hitbox;
      shot.distance = Math.max(0, shot.distance - (projectileSpeed * dt) / 1000);
      const after = projectileGeometry(shot, buffs.dinosaur).hitbox;
      if (sweptContact(before, after, previousPlayer.hitbox, player.hitbox) !== null) {
        state.hp = Math.max(0, state.hp - shot.damage);
        return false;
      }
      return shot.distance > 1e-9;
    });
    const target = selectPlayerTarget(state.enemies);
    if (state.hp > 0 && target && state.attackIn === 0) {
      const critical = nextRandom(state) < buffs.crt;
      const melee = state.enemies.some((enemy) => meleeContact(enemy, buffs.dinosaur, player));
      const duration = Math.min(500, buffs.attackInterval);
      const box = enemyGeometry(target.distance, target.art, target.rank, target.ranged).hitbox;
      const aim = center(box),
        end = attackEndpoint(buffs.dinosaur, box),
        rest = playerGeometry(buffs.dinosaur).sprite;
      state.lastAttack = {
        time: state.clock,
        distance: target.distance,
        damage: buffs.attack * (critical ? 2 : 1) * (melee ? meleeDamageMultiplier : 1),
        critical,
        targetId: target.id,
        art: target.art,
        ranged: target.ranged,
        rank: target.rank,
        duration,
        impactAt: state.clock + Math.ceil((duration * 0.3) / 50) * 50,
        resolved: false,
        mode: melee ? "melee" : "ranged",
        aimX: aim.x,
        aimY: aim.y,
        offsetX: melee ? Math.max(-12, Math.min(18, end.x - rest.x)) : 0,
        offsetY: melee ? Math.max(-12, Math.min(75, end.y - rest.y)) : 0,
      };
      state.attackIn = Math.max(buffs.attackInterval, duration);
    }
    for (const enemy of state.enemies) {
      if (
        enemy.distance <= enemyAttackRange(enemy, buffs.dinosaur, player) + 1e-6 &&
        enemy.attackIn === 0
      ) {
        const damage = incomingDamage(enemy.ad, buffs.def, buffs.defBonus);
        if (enemy.ranged) {
          const shot = {
            id: `${enemy.id}-${state.clock}`,
            ownerId: enemy.id,
            art: enemy.art,
            rank: enemy.rank,
            distance: enemy.distance,
            origin: enemy.distance,
            damage,
          };
          const box = projectileGeometry(shot, buffs.dinosaur).hitbox;
          if (sweptContact(box, box, player.hitbox) !== null)
            state.hp = Math.max(0, state.hp - damage);
          else state.projectiles.push(shot);
        } else state.hp = Math.max(0, state.hp - damage);
        enemy.attackedAt = state.clock;
        enemy.attackIn = enemyAttackInterval(enemy.ranged);
      }
    }
    if (state.hp <= 0) {
      state.lastFailure = { stage: state.stage, wave: state.wave, time: state.clock };
      state.recovery = revivalDelay;
      state.enemies = [];
      state.projectiles = [];
      state.playerProjectiles = [];
      state.killed = 0;
      state.spawned = 0;
      state.attackIn = 0;
      state.lastAttack = null;
      state.lastHit = null;
      state.healthOrbs = [];
      state.pendingGold = 0;
      state.loot = null;
    } else if (state.killed >= waveTarget(state.wave) && state.enemies.length === 0) {
      if (
        state.lastAttack &&
        state.clock < state.lastAttack.time + (state.lastAttack.duration ?? 500)
      )
        continue;
      gold += state.pendingGold;
      state.pendingGold = 0;
      state.transition = {
        kind: state.wave === 10 ? "stage" : "wave",
        elapsed: 0,
        arrived: false,
        fromStage: state.stage,
        fromWave: state.wave,
      };
      state.projectiles = [];
      state.playerProjectiles = [];
      state.lastAttack = null;
    }
  }
  return { combat: state, gold, defeats };
}
