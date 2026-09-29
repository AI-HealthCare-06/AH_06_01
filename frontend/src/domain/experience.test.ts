import { describe, expect, it } from "vitest";
import { experienceProgress } from "./experience";
import { completeQuest, initialGame, quests, restoreGame, rollDay, syncDeviceSteps } from "./game";

describe("persistent quest experience", () => {
  it("awards the advertised EXP once, including automatic walk completion", () => {
    let game = initialGame();
    const snapshot = { date: game.date, count: 6000, source: "healthkit", syncedAt: 10 };
    game = syncDeviceSteps(game, snapshot);
    expect(game.experience).toBe(50);
    game = syncDeviceSteps(game, { ...snapshot, count: 6400, syncedAt: 20 });
    expect(game.experience).toBe(50);
    for (const quest of quests) game = completeQuest(game, quest.id);
    expect(game.experience).toBe(170);
    for (const quest of quests) game = completeQuest(game, quest.id);
    expect(game.experience).toBe(170);
  });

  it("levels at 300, carries overflow, and supports multiple earned levels", () => {
    expect(experienceProgress(0)).toEqual({ level: 12, current: 0, required: 300 });
    expect(experienceProgress(299)).toEqual({ level: 12, current: 299, required: 300 });
    expect(experienceProgress(300)).toEqual({ level: 13, current: 0, required: 300 });
    const game = completeQuest({ ...initialGame(), experience: 290 }, "medicine");
    expect(experienceProgress(game.experience)).toEqual({ level: 13, current: 10, required: 300 });
    expect(experienceProgress(940)).toEqual({ level: 15, current: 40, required: 300 });
  });

  it("preserves cumulative EXP on reload and daily reset", () => {
    const game = completeQuest(initialGame(), "meal");
    expect(restoreGame(JSON.parse(JSON.stringify(game))).experience).toBe(30);
    const next = rollDay(game, "2099-01-01");
    expect(next.completed).toEqual([]);
    expect(next.experience).toBe(30);
    expect(completeQuest(next, "meal", "2099-01-01").experience).toBe(60);
  });

  it("migrates only known real legacy completions without replaying rewards", () => {
    const legacy: Record<string, unknown> = {
      ...initialGame(),
      completed: ["meal", "meal", "walk"],
      coins: 2300,
      dinosaur: 4,
    };
    delete legacy.experience;
    const restored = restoreGame(legacy);
    expect(restored).toMatchObject({ experience: 80, coins: 2300, dinosaur: 4 });
    expect(restoreGame(JSON.parse(JSON.stringify(restored))).experience).toBe(80);
    expect(completeQuest(restored, "meal")).toBe(restored);
    expect(restoreGame({ ...legacy, sampleDay: true }).experience).toBe(0);
    expect(restoreGame({ ...legacy, experience: 0 }).experience).toBe(0);
  });
});
