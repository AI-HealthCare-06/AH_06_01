import { describe, expect, it } from "vitest";
import { initialGame, selectBattleLocation, restoreGame, tickBattle } from "./game";
import { experienceForLevel } from "./experience";
import { characterStats } from "./game-policy";

const now = new Date(2026, 8, 30, 12).getTime();
const seed = () => {
  const game = initialGame("2026-09-30");
  return {
    ...game,
    battleUpdatedAt: now,
    experience: experienceForLevel(7),
    combat: {
      ...game.combat,
      wave: 3,
      hp: 1,
      pendingGold: 120,
      killed: 4,
      recovery: 8000,
      clock: 12300,
      serial: 4,
      seed: 123,
    },
  };
};

describe("manual battle navigation", () => {
  it("keeps earned EXP and banked gold, discards pending rewards and revives at the destination", () => {
    const before = seed();
    const next = selectBattleLocation(before, 2, 1, now);
    expect(next.gold).toBe(before.gold);
    expect(next.experience).toBe(before.experience);
    expect(next.battleDefeats).toBe(before.battleDefeats);
    expect(next.combat).toMatchObject({
      stage: 2,
      wave: 1,
      hp: characterStats(7).hp,
      pendingGold: 0,
      killed: 0,
      spawned: 0,
      recovery: 0,
      enemies: [],
      projectiles: [],
      clock: 12300,
      serial: 4,
      seed: 123,
      transition: { arrived: true },
    });
    const restored = restoreGame(JSON.parse(JSON.stringify(next)));
    const started = tickBattle(restored, now + 1000);
    expect(started.combat.transition).toBeNull();
    expect(started.combat.spawned).toBe(0);
    const fighting = tickBattle(started, now + 1050);
    expect(fighting.combat).toMatchObject({ stage: 2, wave: 1, spawned: 1 });
    expect(fighting.gold).toBe(before.gold);
  });

  it("rejects locked stages, invalid coordinates and same-location resets", () => {
    const before = seed();
    for (const [stage, wave] of [
      [3, 1],
      [6, 1],
      [0, 1],
      [1, 0],
      [1, 11],
      [1.5, 1],
      [1, NaN],
      [1, 3],
    ]) {
      expect(selectBattleLocation(before, stage, wave, now)).toBe(before);
    }
    expect(selectBattleLocation(before, 1, 2, now).combat.wave).toBe(2);
    expect(selectBattleLocation(before, 1, 4, now).combat.wave).toBe(4);
    expect(selectBattleLocation(before, 1, 10, now).combat.wave).toBe(10);
  });

  it("preserves pause and prevents stale projectiles or attacks carrying across locations", () => {
    const before = seed();
    const target = {
      ...before,
      battlePaused: true,
      combat: {
        ...before.combat,
        projectiles: [
          { id: "old", art: 2, rank: "normal" as const, distance: 2, origin: 7, damage: 20 },
        ],
      },
    };
    const next = selectBattleLocation(target, 1, 2, now + 500);
    expect(next.battlePaused).toBe(true);
    expect(next.combat.projectiles).toEqual([]);
    expect(next.combat.lastAttack).toBeNull();
    expect(tickBattle(next, now + 10000).combat).toEqual(next.combat);
  });
});
