import { describe, expect, it } from "vitest";
import {
  initialGame,
  tickBattle,
  restoreGame,
  completeQuest,
  rollDay,
  questCountOn,
  weeklyCompletedDays,
} from "./game";
import type { GameState } from "./game";
import { battleBuffStats, clearDuration, travelDuration, startDuration } from "./battle";
import { reportDateRange } from "../services/health-history";

const now = new Date(2026, 8, 30, 12).getTime();
const target = {
  id: 1,
  art: 0,
  rank: "normal" as const,
  hp: 1,
  maxHp: 70,
  ad: 0,
  distance: 1,
  attackIn: 5000,
  ranged: false,
  hitAt: -1000,
};
const seed = (): GameState => {
  const game = initialGame("2026-09-30");
  return {
    ...game,
    experience: 99,
    battleUpdatedAt: now,
    combat: { ...game.combat, spawned: 1, spawnIn: 5000, enemies: [target] },
  };
};

describe("wave rewards and saved history", () => {
  it("keeps kill EXP and level after defeat, discards only unbanked battle GOLD, and saves safely", () => {
    const first = tickBattle(seed(), now + 50);
    expect(first.experience).toBe(100);
    expect(battleBuffStats(first)).toMatchObject({ maxHp: 55, attack: 22 });
    expect(first.gold).toBe(1280);
    expect(first.combat.pendingGold).toBe(1030); // 30 kill + Lv.2 reward, both await clear.
    const saved = restoreGame(JSON.parse(JSON.stringify(first)));
    expect(saved.combat.pendingGold).toBe(1030);
    const failed = tickBattle(
      {
        ...saved,
        combat: { ...saved.combat, hp: 1, enemies: [{ ...target, hp: 70, ad: 1000, attackIn: 0 }] },
      },
      now + 100,
    );
    expect(failed.combat.recovery).toBe(10000);
    expect(failed.combat.pendingGold).toBe(0);
    expect(failed.experience).toBe(100);
    expect(failed.gold).toBe(1280);
  });
  it("banks one clear reward, restores HP at the next wave, and holds spawns until the start banner ends", () => {
    const game = seed();
    game.combat = { ...game.combat, hp: 5, spawned: 30, killed: 29, pendingGold: 870 };
    const cleared = tickBattle(game, now + 50);
    expect(cleared.gold).toBe(1280 + 1900);
    expect(cleared.combat.pendingGold).toBe(0);
    expect(cleared.combat.hp).toBe(5);
    const arrival = now + 50 + clearDuration("wave") + travelDuration;
    const started = tickBattle(restoreGame(JSON.parse(JSON.stringify(cleared))), arrival);
    expect(started.combat).toMatchObject({
      wave: 2,
      hp: 55,
      spawned: 0,
      transition: { arrived: true },
    });
    expect(started.gold).toBe(cleared.gold);
    const ready = tickBattle(started, arrival + startDuration);
    expect(ready.combat.spawned).toBe(0);
    expect(ready.combat.transition).toBeNull();
    expect(tickBattle(ready, arrival + startDuration + 50).combat.spawned).toBe(1);
    expect(tickBattle(ready, arrival + startDuration)).toBe(ready);
  });
  it("produces the same growing character and rewards online, offline and after reload", () => {
    const game = seed();
    const offline = tickBattle(game, now + 120000);
    let online = game;
    for (let ms = 50; ms <= 120000; ms += 50) online = tickBattle(online, now + ms);
    expect(online).toEqual(offline);
    const halfway = restoreGame(JSON.parse(JSON.stringify(tickBattle(game, now + 60000))));
    expect(tickBattle(halfway, now + 120000)).toEqual(offline);
  });
  it("retains partial daily quest counts and validates period boundaries", () => {
    let game = initialGame("2026-09-29");
    game = completeQuest(game, "medicine", "2026-09-29", now);
    game = completeQuest(game, "meal", "2026-09-29", now);
    const next = restoreGame(JSON.parse(JSON.stringify(rollDay(game, "2026-09-30"))));
    expect(questCountOn(next, "2026-09-29")).toBe(2);
    expect(questCountOn(next, "2026-09-30")).toBe(0);
    const history = { ...next, questHistory: { ...next.questHistory, "2026-09-26": 5 } };
    expect(weeklyCompletedDays(history, "2026-09-26")).toBe(1);
    expect(weeklyCompletedDays(history)).toBe(0);
    expect(questCountOn({ ...next, completedDates: ["2026-09-28"] }, "2026-09-28")).toBe(5);
    expect(reportDateRange("week", "2026-01-03")).toEqual({
      start: "2025-12-28",
      end: "2026-01-03",
    });
    expect(reportDateRange("month", "2026-09-30").start).toBe("2026-09-01");
    expect(reportDateRange("custom", "2026-09-30", "2026-10-01").start).toBe("2026-09-30");
  });
});
