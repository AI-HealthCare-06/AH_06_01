import { describe, expect, it } from "vitest";
import {
  advanceCombat,
  battleBuffStats,
  combatSchema,
  initialCombat,
  type CombatState,
} from "./battle";
import {
  center,
  enemyGeometry,
  playerGeometry,
  projectileGeometry,
  sweptContact,
} from "./battle-geometry";
import { enemyAttackRange } from "./battle-range";
import { healthOrbDropChance, healthOrbRecovery } from "./game-policy";
import { initialGame, restoreGame, tickBattle } from "./game";

const buffs = battleBuffStats(initialGame());
const enemy = {
  id: 1,
  art: 0,
  rank: "normal" as const,
  hp: 1,
  maxHp: 70,
  ad: 0,
  distance: 7,
  attackIn: 5000,
  ranged: true,
  hitAt: -1000,
};
const strike = {
  time: 0,
  impactAt: 50,
  resolved: false,
  targetId: 1,
  distance: 7,
  damage: 20,
  critical: false,
  duration: 500,
};
const scenario = (seed = 42): CombatState => ({
  ...initialCombat(10),
  seed,
  spawned: 1,
  spawnIn: 5000,
  attackIn: 5000,
  enemies: [{ ...enemy }],
  lastAttack: { ...strike },
});

describe("enemy-owned projectiles", () => {
  it.each(["pending strike", "player projectile"])(
    "a lethal %s removes every owner shot before same-tick contact",
    (mode) => {
      const input = scenario();
      input.hp = 50;
      const other = { ...enemy, id: 2, hp: 1000, distance: 7.5 };
      input.enemies.push(other);
      input.spawned = 2;
      const player = playerGeometry(0).hitbox;
      let distance = 3;
      while (
        sweptContact(
          projectileGeometry({ art: 0, origin: 7, distance }, 0).hitbox,
          projectileGeometry({ art: 0, origin: 7, distance: distance - 0.3 }, 0).hitbox,
          player,
        ) === null
      )
        distance -= 0.01;
      input.projectiles = [
        { id: "contact", ownerId: 1, art: 0, origin: 7, distance, damage: 100 },
        { id: "flight", ownerId: 1, art: 0, origin: 7, distance: 6, damage: 100 },
        { id: "other", ownerId: 2, art: 0, origin: 7, distance: 6, damage: 10 },
      ];
      if (mode === "player projectile") {
        input.lastAttack = null;
        const body = enemyGeometry(7, 0, "normal", true).hitbox;
        input.playerProjectiles = [
          {
            id: "kill",
            dinosaur: 0,
            ...center(body),
            vx: 240,
            vy: 0,
            age: 0,
            travelled: 0,
            damage: 20,
            critical: false,
          },
        ];
      }
      const result = advanceCombat(input, buffs, 1, 50);
      expect(result.defeats).toBe(1);
      expect(result.combat.hp).toBe(50);
      expect(result.combat.recovery).toBe(0);
      expect(result.combat.projectiles.map((shot) => shot.id)).toEqual(["other"]);
      expect(result.combat.projectiles[0].distance).toBeCloseTo(5.7);
      expect(input.projectiles).toHaveLength(3);
    },
  );
  it("removes already-overlapping orphan shots, including legacy saves, without damage", () => {
    const input = {
      ...scenario(),
      enemies: [],
      lastAttack: null,
      projectiles: [{ id: "1-100", art: 0, origin: 7, distance: 0.5, damage: 100 }],
    };
    const result = advanceCombat(
      combatSchema.parse(JSON.parse(JSON.stringify(input))),
      buffs,
      1,
      50,
    ).combat;
    expect(result.hp).toBe(10);
    expect(result.projectiles).toEqual([]);
  });
  it("keeps legacy shots attached to a living owner, without reverting earlier damage", () => {
    const input = scenario();
    input.lastAttack = null;
    input.enemies[0].hp = 1000;
    input.hp = 50;
    input.projectiles = [{ id: "1-100", art: 0, origin: 7, distance: 0.5, damage: 10 }];
    const hit = advanceCombat(input, buffs, 1, 50).combat;
    expect(hit.hp).toBe(40);
    const killed = advanceCombat(
      { ...hit, lastAttack: { ...strike, impactAt: 100 }, enemies: [{ ...enemy }] },
      buffs,
      1,
      50,
    ).combat;
    expect(killed.enemies).toEqual([]);
    expect(killed.hp).toBe(40);
  });
});

describe("immediate health orb drops", () => {
  it("uses 10% drops and the exact conditional 50/30/15/5 tier boundaries", () => {
    expect(healthOrbDropChance).toBe(0.1);
    expect(
      [0, 0.499999, 0.5, 0.799999, 0.8, 0.949999, 0.95, 0.999999].map(healthOrbRecovery),
    ).toEqual([0.1, 0.1, 0.2, 0.2, 0.4, 0.4, 1, 1]);
    const counts = new Map<number, number>();
    for (let drop = 0; drop < 100; drop++)
      for (let tier = 0; tier < 100; tier++) {
        if ((drop + 0.5) / 100 >= healthOrbDropChance) continue;
        const fraction = healthOrbRecovery((tier + 0.5) / 100);
        counts.set(fraction, (counts.get(fraction) ?? 0) + 1);
      }
    expect([...counts.entries()]).toEqual([
      [0.1, 500],
      [0.2, 300],
      [0.4, 150],
      [1, 50],
    ]);
  });
  it.each([
    [1972, 0.1, 4],
    [1976, 0.2, 8],
    [1980, 0.4, 16],
    [1981, 1, 40],
  ])("seed %i drops a %s orb and immediately heals %s missing HP", (seed, fraction, healed) => {
    const input = scenario(seed);
    const hit = advanceCombat(input, buffs, 1, 50);
    expect(hit.defeats).toBe(1);
    expect(hit.combat.hp).toBe(10 + healed);
    expect(hit.combat.healthOrbs).toHaveLength(1);
    expect(hit.combat.healthOrbs[0]).toMatchObject({
      time: 50,
      fraction,
      healed,
      ...center(enemyGeometry(7, 0, "normal", true).hitbox),
    });
    expect(input.hp).toBe(10);
    expect(input.healthOrbs).toEqual([]);
    const saved = combatSchema.parse(JSON.parse(JSON.stringify(hit.combat)));
    const after = advanceCombat(saved, buffs, 1, 900).combat;
    expect(after.hp).toBe(hit.combat.hp);
    expect(after.healthOrbs).toEqual([]);
  });
  it("no-drop kills still award EXP/GOLD, and full HP drops never overheal", () => {
    const noDrop = advanceCombat(scenario(), buffs, 1, 50);
    expect(noDrop).toMatchObject({
      defeats: 1,
      combat: { hp: 10, pendingGold: 30, healthOrbs: [] },
    });
    const full = advanceCombat({ ...scenario(1981), hp: 50 }, buffs, 1, 50).combat;
    expect(full.hp).toBe(50);
    expect(full.healthOrbs[0].healed).toBe(0);
    const fractional = advanceCombat({ ...scenario(1972), hp: 49.5 }, buffs, 1, 50).combat;
    expect(fractional.hp).toBeCloseTo(49.55);
  });
  it("multiple AoE kills roll separately and each heal uses the remaining missing HP", () => {
    let seed = 0;
    for (; seed < 100000; seed++) {
      const rolls: number[] = [];
      let next = seed;
      for (let i = 0; i < 4; i++) {
        next = (Math.imul(next, 1664525) + 1013904223) >>> 0;
        rolls.push(next / 4294967296);
      }
      if (rolls[0] < 0.1 && rolls[2] < 0.1 && rolls[1] < 0.95) break;
    }
    expect(seed).toBeLessThan(100000);
    const input = scenario(seed);
    const melee = { ...enemy, art: 3, ranged: false };
    const stop = enemyAttackRange(melee, 0);
    input.enemies = [
      { ...melee, distance: stop },
      { ...melee, id: 2, distance: stop + 0.5 },
    ];
    input.spawned = 2;
    input.lastAttack = { ...strike, mode: "melee" };
    const hit = advanceCombat(input, buffs, 1, 50);
    expect(hit.defeats).toBe(2);
    expect(hit.combat.healthOrbs).toHaveLength(2);
    const [first, second] = hit.combat.healthOrbs;
    expect(first.healed).toBeCloseTo(40 * first.fraction);
    expect(second.healed).toBeCloseTo((40 - first.healed) * second.fraction);
    expect(hit.combat.hp).toBeCloseTo(10 + first.healed + second.healed);
  });
  it("pause, reload and offline advancement preserve rolls and never reapply the heal", () => {
    const now = new Date(2026, 9, 1, 12).getTime();
    const game = { ...initialGame("2026-10-01"), battleUpdatedAt: now, combat: scenario(1976) };
    const direct = tickBattle(game, now + 1000);
    const hit = tickBattle(game, now + 50);
    const paused = tickBattle({ ...hit, battlePaused: true }, now + 5000);
    expect(paused.combat).toEqual(hit.combat);
    const saved = restoreGame(JSON.parse(JSON.stringify(paused)));
    const resumed = tickBattle({ ...saved, battlePaused: false }, now + 5950);
    expect(resumed.combat).toEqual(direct.combat);
    expect(resumed.combat.hp).toBe(18);
    expect(resumed.battleDefeats).toBe(1);
    const legacy = combatSchema.parse({ ...initialCombat(), healthOrbs: undefined });
    expect(legacy.healthOrbs).toEqual([]);
  });
});
