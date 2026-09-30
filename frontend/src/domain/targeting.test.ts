import { describe, expect, it } from "vitest";
import { advanceCombat, battleBuffStats, combatSchema, initialCombat } from "./battle";
import { selectPlayerTarget } from "./battle-range";
import { projectileGeometry } from "./battle-geometry";
import { initialGame } from "./game";

const buffs = battleBuffStats(initialGame());
const ranged = {
  id: 1,
  art: 0,
  rank: "normal" as const,
  ranged: true,
  distance: 7,
  hp: 1000,
  maxHp: 1000,
  ad: 0,
  attackIn: 5000,
  hitAt: -1000,
};

describe("closest target and ranged pursuit", () => {
  it("always selects the nearest and permits distant strikes only while every living enemy is ranged", () => {
    const melee = { ...ranged, id: 2, ranged: false, distance: 2 };
    expect(selectPlayerTarget([ranged, melee])?.id).toBe(2);
    expect(selectPlayerTarget([{ ...ranged, distance: 1 }, melee])?.id).toBe(1);
    expect(selectPlayerTarget([ranged, { ...melee, distance: 4 }])).toBeUndefined();
    expect(selectPlayerTarget([ranged, { ...ranged, id: 3, distance: 6 }])?.id).toBe(3);
    expect(selectPlayerTarget([{ ...melee, id: 4 }, melee])?.id).toBe(2);
  });
  it("persists the longer strike, damages once at contact, then returns before wave clear", () => {
    const input = {
      ...initialCombat(),
      spawned: 30,
      killed: 29,
      spawnIn: 3000,
      enemies: [{ ...ranged, hp: 1 }],
    };
    const started = advanceCombat(input, buffs, 1, 50).combat;
    expect(started.lastAttack).toMatchObject({
      targetId: 1,
      duration: 1200,
      impactAt: 450,
      resolved: false,
    });
    expect(started.enemies[0].hp).toBe(1);
    const before = advanceCombat(
      combatSchema.parse(JSON.parse(JSON.stringify(started))),
      buffs,
      1,
      350,
    ).combat;
    expect(before.enemies[0].hp).toBe(1);
    const hit = advanceCombat(before, buffs, 1, 50);
    expect(hit.defeats).toBe(1);
    expect(hit.gold).toBe(30);
    expect(hit.combat.enemies).toHaveLength(0);
    expect(hit.combat.transition).toBeNull();
    expect(before.lastAttack?.resolved).toBe(false);
    const returning = advanceCombat(hit.combat, buffs, 1, 750);
    expect(returning.defeats).toBe(0);
    expect(returning.combat.transition).toBeNull();
    expect(advanceCombat(returning.combat, buffs, 1, 50).combat.transition?.kind).toBe("wave");
  });
  it("finishes its locked strike if a melee arrives, then targets that nearer enemy", () => {
    const started = advanceCombat(
      { ...initialCombat(), spawned: 1, spawnIn: 5000, enemies: [ranged] },
      buffs,
      1,
      50,
    ).combat;
    started.enemies.push({ ...ranged, id: 2, ranged: false, distance: 2 });
    const hit = advanceCombat(started, buffs, 1, 400).combat;
    expect(hit.enemies.find((enemy) => enemy.id === 1)?.hp).toBe(980);
    expect(hit.enemies.find((enemy) => enemy.id === 2)?.hp).toBe(1000);
    const next = advanceCombat(hit, buffs, 1, 800).combat;
    expect(next.lastAttack?.targetId).toBe(2);
    expect(next.enemies.find((enemy) => enemy.id === 2)?.hp).toBe(980);
    const box = projectileGeometry({ art: 0, origin: 7, distance: 7 }, 0).sprite;
    expect(box.width).toBeCloseTo(28 * 1.4);
    expect(box.height).toBeCloseTo(21 * 1.4);
  });
});
