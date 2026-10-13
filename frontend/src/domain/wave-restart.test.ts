import { describe, expect, it } from "vitest";
import { initialGame, restoreGame, retryBattle, tickBattle } from "./game";
const now = new Date(2026, 9, 1, 12).getTime();
function losingGame() {
  const game = initialGame("2026-10-01");
  return {
    ...game,
    waveAutoRestart: false,
    experience: 101,
    gold: 2000,
    battleUpdatedAt: now,
    combat: {
      ...game.combat,
      hp: 1,
      wave: 3,
      spawned: 1,
      pendingGold: 400,
      spawnIn: 10000,
      attackIn: 10000,
      enemies: [
        {
          id: 1,
          art: 0,
          rank: "normal" as const,
          hp: 100,
          maxHp: 100,
          ad: 1000,
          distance: 0,
          attackIn: 0,
          ranged: false,
          hitAt: -1000,
        },
      ],
    },
  };
}
describe("wave restart preference", () => {
  it("holds a failed wave across offline time and reload, without losing earned rewards", () => {
    const failed = tickBattle(losingGame(), now + 50);
    expect(failed.combat.lastFailure).toEqual({ stage: 1, wave: 3, time: 50 });
    expect(failed.combat).toMatchObject({ hp: 0, recovery: 10000, pendingGold: 0, spawned: 0 });
    const reloaded = restoreGame(JSON.parse(JSON.stringify(failed)));
    const held = tickBattle(reloaded, now + 60000);
    expect(held).toMatchObject({ waveAutoRestart: false, experience: 101, gold: 2000 });
    expect(held.combat).toMatchObject({
      hp: 0,
      recovery: 10000,
      spawned: 0,
      wave: 3,
      clock: 60000,
      lastFailure: failed.combat.lastFailure,
    });
    const retried = retryBattle(held, now + 60000);
    expect(retried.combat).toMatchObject({
      hp: 55,
      recovery: 0,
      wave: 3,
      spawned: 0,
      transition: { arrived: true },
      lastFailure: failed.combat.lastFailure,
    });
    expect(retried.gold).toBe(2000);
    expect(tickBattle(retried, now + 61000).combat.spawned).toBe(0);
    expect(tickBattle(retried, now + 61050).combat.spawned).toBe(1);
  });
  it("restores automatic recovery when enabled and defaults old saves to ON", () => {
    const failed = tickBattle(losingGame(), now + 50);
    const enabled = { ...failed, waveAutoRestart: true };
    expect(tickBattle(enabled, now + 10050).combat).toMatchObject({ hp: 55, recovery: 0 });
    const legacy = JSON.parse(JSON.stringify(failed));
    delete legacy.waveAutoRestart;
    delete legacy.combat.lastFailure;
    expect(restoreGame(legacy)).toMatchObject({
      waveAutoRestart: true,
      combat: { lastFailure: null },
    });
    const healthy = initialGame();
    expect(retryBattle(healthy, healthy.battleUpdatedAt)).toBe(healthy);
  });
});
