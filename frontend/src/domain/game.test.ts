import { describe, expect, it } from "vitest";
import {
  claimDailyBonus,
  completeQuest,
  initialGame,
  quests,
  restoreGame,
  rollDay,
  seoulDate,
  stageProgress,
} from "./game";
describe("demo reward rules", () => {
  it("awards a quest once, including retries", () => {
    const initial = initialGame();
    const first = completeQuest(initial, "walk");
    expect(first.coins).toBe(1310);
    expect(first.completed).toContain("walk");
    expect(completeQuest(first, "walk")).toBe(first);
  });
  it("awards the all-done 50% bonus exactly once", () => {
    let game = initialGame();
    for (const q of quests) game = completeQuest(game, q.id);
    expect(game.coins).toBe(1400);
    expect(game.lastReward?.coins).toBe(70);
    expect(game.allDoneBonusClaimed).toBe(true);
    expect(completeQuest(game, "sleep").coins).toBe(1400);
    expect(stageProgress(game)).toBe(10);
  });
  it("daily coin is idempotent and available again next Seoul day", () => {
    const game = claimDailyBonus(initialGame("2026-09-28"), "2026-09-28");
    expect(game.coins).toBe(1290);
    expect(claimDailyBonus(game, "2026-09-28")).toBe(game);
    const next = claimDailyBonus(game, "2026-09-29");
    expect(next.coins).toBe(1300);
    expect(next.completed).toEqual([]);
  });
  it("resets daily flags while preserving currency and dinosaur", () => {
    const initial = {
      ...initialGame("2026-09-27"),
      dinosaur: 4,
      coins: 1500,
      bonusClaimed: true,
      allDoneBonusClaimed: true,
    };
    const next = rollDay(initial, "2026-09-28");
    expect(next).toMatchObject({
      date: "2026-09-28",
      coins: 1500,
      dinosaur: 4,
      completed: [],
      bonusClaimed: false,
      allDoneBonusClaimed: false,
      lastReward: null,
    });
    expect(stageProgress(next)).toBe(0);
  });
  it("uses the Seoul midnight boundary", () => {
    expect(seoulDate(new Date("2026-09-27T14:59:59Z"))).toBe("2026-09-27");
    expect(seoulDate(new Date("2026-09-27T15:00:00Z"))).toBe("2026-09-28");
  });
  it("recovers invalid storage and removes repeated quest ids", () => {
    expect(restoreGame({ coins: -100 })).toEqual(initialGame());
    const data = { ...initialGame(), completed: ["walk", "walk"] };
    expect(restoreGame(data).completed).toEqual(["walk"]);
  });
});
