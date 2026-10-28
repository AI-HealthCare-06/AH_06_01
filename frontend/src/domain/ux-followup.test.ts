import { describe, expect, it } from "vitest";
import { initialGame } from "./game";
import { radarData } from "./dino-radar";
import { advanceCombat, battleBuffStats, initialCombat } from "./battle";
import { createDemoGame } from "./demo-persona";
const date = "2026-10-28",
  now = new Date(date + "T12:00:00").getTime();
describe("recorded radar and projectile cleanup", () => {
  it("reads actual recorded values and reacts to new progress without inventing missing sleep", () => {
    const empty = radarData(initialGame(date));
    expect(empty.elapsed).toBe(1);
    expect(empty.today[2]).toBeNull();
    expect(empty.today[4]).toBeNull();
    const game = createDemoGame(date, now);
    const before = radarData(game);
    expect(before.elapsed).toBe(7);
    expect(before.first).toBe("2026-10-22");
    expect(before.today).toEqual([0, 100, 89, 100, 70, 50]);
    game.completed.push("walk");
    game.steps!.count = 6000;
    expect(radarData(game).today).toEqual([0, 100, 89, 100, 100, 75]);
    expect(radarData(game).dayOne).toEqual(before.dayOne);
  });
  it("drops an in-flight shot whose target died while preserving a living target's projectile", () => {
    const stats = battleBuffStats(initialGame(date));
    const enemy = {
      id: 2,
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
    const shot = {
      id: "stale",
      dinosaur: 0,
      x: 90,
      y: 180,
      vx: 300,
      vy: 0,
      age: 0,
      travelled: 0,
      damage: 20,
      critical: false,
      targetId: 1,
    };
    const combat = {
      ...initialCombat(),
      spawned: 1,
      spawnIn: 5000,
      attackIn: 5000,
      enemies: [enemy],
      playerProjectiles: [shot, { ...shot, id: "live", targetId: 2 }],
    };
    const result = advanceCombat(combat, stats, 1, 50).combat;
    expect(result.playerProjectiles.map((p) => p.id)).toEqual(["live"]);
  });
  it("does not release a pending ranged attack after its target has disappeared", () => {
    const stats = battleBuffStats(initialGame(date));
    let combat = initialCombat();
    combat.spawnIn = 5000;
    combat.spawned = 1;
    combat.enemies = [
      {
        id: 1,
        art: 0,
        rank: "normal",
        ranged: true,
        distance: 7,
        hp: 100,
        maxHp: 100,
        ad: 0,
        attackIn: 5000,
        hitAt: -1000,
      },
    ];
    combat = advanceCombat(combat, stats, 1, 50).combat;
    expect(combat.lastAttack?.mode).toBe("ranged");
    combat.enemies = [];
    combat.attackIn = 5000;
    expect(advanceCombat(combat, stats, 1, 200).combat.playerProjectiles).toHaveLength(0);
  });
});
