import { surveyFixture } from "./daily-survey.test-fixture";
import { recordDailySurvey, mainQuests } from "./game";
import { describe, expect, it } from "vitest";
import { completeQuest, initialGame, rollDay, tickBattle, restoreGame } from "./game";
import { dailyCombatExperienceLimit } from "./experience";
import { questRewards } from "./quest-policy";
describe("quest-led growth", () => {
  it("keeps a full day of combat below the smallest first quest and does not refill on reload", () => {
    const now = new Date(2026, 9, 22, 0).getTime();
    const game = { ...initialGame("2026-10-22"), battleUpdatedAt: now };
    const after = tickBattle(game, now + 23 * 3_600_000);
    expect(after.experience).toBe(40);
    expect(after.combatExperienceToday).toBe(40);
    // Later kills must not advertise experience after the daily cap.
    expect(after.combat.loot?.experience).toBe(0);
    expect(after.experience).toBeLessThan(
      Math.min(...Object.values(questRewards).map((q) => q.experience)),
    );
    const restored = restoreGame(JSON.parse(JSON.stringify(after)));
    expect(tickBattle(restored, now + 23.5 * 3_600_000).experience).toBe(40);
    expect(rollDay(restored, "2026-10-23").combatExperienceToday).toBe(0);
    expect(dailyCombatExperienceLimit(0)).toBe(40);
  }, 60_000);
  it("gives 480 main-quest EXP and all-day bonus once without back-crediting existing saves", () => {
    let game = initialGame();
    game.steps = { date: game.date, count: 6000, source: "healthkit", syncedAt: Date.now() };
    game = recordDailySurvey(game, surveyFixture(game.date), game.date);
    for (const quest of mainQuests) game = completeQuest(game, quest.id);
    expect(game.experience).toBe(480);
    expect(game.gold).toBe(6780);
    const before = game;
    for (const quest of mainQuests) game = completeQuest(game, quest.id);
    expect(game).toBe(before);
    const saved = { ...game, experience: 9999, gold: 7777 };
    expect(restoreGame(saved)).toMatchObject({ experience: 9999, gold: 7777 });
  });
});
