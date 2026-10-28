import { surveyFixture } from "./daily-survey.test-fixture";
import { recordDailySurvey, mainQuests } from "./game";
import { describe, expect, it } from "vitest";
import { experienceProgress, levelUpGold, questExperience } from "./experience";
import {
  completeQuest,
  initialGame,
  restoreGame,
  rollDay,
  syncDeviceSteps,
  repeatDemoQuest,
} from "./game";

describe("document experience progression", () => {
  it("keeps the water cooldown across midnight without carrying yesterday's buff", () => {
    const first = new Date(2026, 8, 29, 23).getTime();
    const day = completeQuest(initialGame("2026-09-29"), "water", "2026-09-29", first);
    const early = completeQuest(day, "water", "2026-09-30", first + 3_600_000);
    expect(early.completed).toEqual([]);
    expect(early.experience).toBe(100);
    const allowed = completeQuest(early, "water", "2026-09-30", first + 7_200_000);
    expect(allowed.experience).toBe(200);
    expect(allowed.activity.water).toBe(1);
  });
  it("awards quests once and first quest Gold plus attained-level Gold", () => {
    let game = initialGame();
    const snapshot = { date: game.date, count: 6000, source: "healthkit", syncedAt: 10 };
    game = syncDeviceSteps(game, snapshot);
    expect(game.experience).toBe(180);
    expect(game.gold).toBe(2580);
    game = syncDeviceSteps(game, { ...snapshot, count: 8000, syncedAt: 20 });
    game = recordDailySurvey(game, surveyFixture(game.date), game.date);
    for (const quest of mainQuests) game = completeQuest(game, quest.id);
    expect(game.experience).toBe(480);
    expect(game.gold).toBe(6780);
    for (const quest of mainQuests) game = completeQuest(game, quest.id);
    expect(game.experience).toBe(480);
  });
  it("uses successive floored 1.22 thresholds with overflow and multiple level rewards", () => {
    expect(experienceProgress(0)).toEqual({ level: 1, current: 0, required: 100 });
    expect(experienceProgress(99).level).toBe(1);
    expect(experienceProgress(100)).toEqual({ level: 2, current: 0, required: 122 });
    expect(experienceProgress(232)).toEqual({ level: 3, current: 10, required: 148 });
    const game = completeQuest({ ...initialGame(), experience: 90 }, "medicine");
    expect(experienceProgress(game.experience)).toEqual({ level: 2, current: 70, required: 122 });
    expect(levelUpGold(0, 232)).toBe(2500);
    expect(questExperience(20, 550)).toBe(30);
    expect(questExperience(20, 2600)).toBe(45);
  });
  it("retains EXP across rollover/reload and only gives 10% on explicit allowed repeats", () => {
    let game = completeQuest(initialGame(), "meal");
    expect(restoreGame(JSON.parse(JSON.stringify(game))).experience).toBe(120);
    expect(rollDay(game, "2099-01-01").experience).toBe(120);
    for (let i = 0; i < 10; i++) game = repeatDemoQuest(game, "meal");
    expect(game.experience).toBe(144);
    expect(game.activity.meal).toBe(3);
    const morning = new Date();
    morning.setHours(10, 0, 0, 0);
    const water = { ...completeQuest(game, "water"), lastWaterAt: morning.getTime() };
    expect(repeatDemoQuest(water, "water", water.lastWaterAt! + 7_199_999)).toBe(water);
    expect(repeatDemoQuest(water, "water", water.lastWaterAt! + 7_200_000).experience).toBe(
      water.experience + 10,
    );
    expect(game.gold).toBe(2480);
  });
  it("migrates known legacy completions, gold defaults and waves without inventing rewards", () => {
    const legacy: Record<string, unknown> = {
      ...initialGame(),
      completed: ["meal", "meal", "walk"],
      version: 1,
      coins: 2300,
      dinosaur: 4,
      battleDefeats: 70,
    };
    delete legacy.experience;
    delete legacy.combat;
    delete legacy.gold;
    const restored = restoreGame(legacy);
    expect(restored).toMatchObject({
      experience: 80,
      gold: 2300,
      dinosaur: 4,
      combat: { stage: 1, wave: 3, killed: 0 },
    });
    expect(restoreGame(JSON.parse(JSON.stringify(restored))).experience).toBe(80);
    expect(completeQuest(restored, "meal")).toBe(restored);
    expect(restoreGame({ ...legacy, sampleDay: true }).experience).toBe(0);
    expect(restoreGame({ ...legacy, experience: 0 }).experience).toBe(0);
  });
});
