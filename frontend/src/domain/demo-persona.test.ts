import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoGame } from "./demo-persona";
import { dailySurveySchema, sleepHoursFromTimes, validDailySurvey } from "./daily-survey";
import { mainQuestCount, recordDailySurvey, restoreGame } from "./game";
import { questExperience } from "./experience";

const date = "2026-10-27";
const now = new Date(date + "T12:00:00").getTime();
describe("synthetic demo survey week", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());
  it("seeds seven complete survey days with matching health and main quest history", () => {
    const game = createDemoGame(date, now);
    const dates = Object.keys(game.dailySurveys);
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-10-21");
    expect(dates.at(-1)).toBe(date);
    for (const day of dates) {
      const survey = dailySurveySchema.parse(game.dailySurveys[day]);
      expect(validDailySurvey(survey, day, now)).not.toBeNull();
      expect(sleepHoursFromTimes(survey.bedtime, survey.wakeTime)).toBe(survey.sleepHours);
      expect(game.healthHistory[day]).toMatchObject({
        sleepHours: survey.sleepHours,
        systolic: survey.morning!.systolic,
        diastolic: survey.morning!.diastolic,
        restingHr: survey.restingHr,
        glucose: survey.fastingGlucose,
      });
      expect(game.questHistoryDetails[day]).toContain("survey");
      expect(game.questHistoryDetails[day]).not.toContain("sleep");
      expect(game.questHistory[day]).toBe(mainQuestCount(game.questHistoryDetails[day]));
      const reward = game.sleepExperience[day];
      expect(reward.base).toBe(Math.floor(survey.sleepHours! * 20));
      expect(reward.experience).toBe(questExperience(reward.base, reward.baseline));
    }
    expect(game.dailySurveys["2026-10-24"].daytimeSleepinessScore).toBe(0);
    expect(game.dailySurveys["2026-10-26"].activeMinutes).toBe(0);
    expect(game.completed).toEqual(["meal", "survey"]);
    expect(game.activity).toMatchObject({ meal: 1, survey: 1 });
    expect(game.completedDates).toEqual(["2026-10-24"]);
  });
  it("restores the credited week and cannot award today's survey or sleep twice", () => {
    const seeded = createDemoGame(date, now);
    const restored = restoreGame(JSON.parse(JSON.stringify(seeded)));
    const again = recordDailySurvey(restored, restored.dailySurveys[date], date, now);
    expect(again.experience).toBe(seeded.experience);
    expect(again.gold).toBe(seeded.gold);
    expect(again.sleepExperience).toEqual(seeded.sleepExperience);
    expect(
      Object.values(seeded.sleepExperience).reduce((sum, r) => sum + r.experience, 0),
    ).toBeGreaterThan(0);
    const current = seeded.sleepExperience[date];
    const changed = recordDailySurvey(
      restored,
      { ...restored.dailySurveys[date], bedtime: "22:00", sleepHours: 8 },
      date,
      now,
    );
    expect(changed.experience - restored.experience).toBe(
      questExperience(160, current.baseline) - current.experience,
    );
    expect(changed.firstQuestExp.survey).toBe(restored.firstQuestExp.survey);
  });
  it("moves the rolling synthetic week across month boundaries without future submissions", () => {
    const next = createDemoGame("2026-11-01", new Date("2026-11-01T01:00:00").getTime());
    expect(Object.keys(next.dailySurveys)).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(
      validDailySurvey(
        next.dailySurveys[next.date],
        next.date,
        new Date("2026-11-01T01:00:00").getTime(),
      ),
    ).not.toBeNull();
  });
});
