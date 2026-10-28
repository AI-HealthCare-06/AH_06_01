import { describe, expect, it } from "vitest";
import { dailySurveySchema, sleepHoursFromTimes } from "./daily-survey";
import { initialGame, recordDailySurvey, restoreGame, awardSleepExperience } from "./game";
import { surveyFixture } from "./daily-survey.test-fixture";
import { discountedRetailRp } from "./retail-pricing";
const date = "2026-10-27",
  now = new Date(2026, 9, 27, 12).getTime();
describe("survey revision", () => {
  it("derives overnight sleep from real times without interpreting equal clocks as 24 hours", () => {
    expect(sleepHoursFromTimes("23:30", "06:15")).toBe(6.75);
    expect(sleepHoursFromTimes("01:00", "07:00")).toBe(6);
    expect(sleepHoursFromTimes("06:00", "06:00")).toBeNull();
    expect(sleepHoursFromTimes("25:00", "06:00")).toBeNull();
    expect(sleepHoursFromTimes(null, "06:00")).toBeNull();
  });
  it("keeps numeric 0 and 10 ratings with presence flags while restoring legacy booleans", () => {
    const base = { ...surveyFixture(date), submittedAt: now };
    expect(
      dailySurveySchema.parse({
        ...base,
        snoringScore: 0,
        snoring: false,
        daytimeSleepinessScore: 10,
        daytimeSleepiness: true,
      }).snoringScore,
    ).toBe(0);
    expect(dailySurveySchema.safeParse({ ...base, snoringScore: 11 }).success).toBe(false);
    expect(dailySurveySchema.safeParse({ ...base, snoringScore: 5, snoring: false }).success).toBe(
      false,
    );
    expect(dailySurveySchema.parse({ ...base, snoring: true }).snoringScore).toBeUndefined();
  });
  it("caps sleep EXP across corrections and reloads and does not require a sleep quest", () => {
    const base = {
      ...surveyFixture(date),
      submittedAt: now,
      sleepInputKind: "times",
      sleepStatus: "reported",
      bedtime: "23:00",
      wakeTime: "06:00",
      sleepHours: 7,
    };
    const first = recordDailySurvey(initialGame(date), base, date, now);
    expect(first.sleepExperience[date].base).toBe(140);
    expect(first.completed).toEqual(["survey"]);
    const again = recordDailySurvey(restoreGame(first), base, date, now);
    expect(again.experience).toBe(first.experience);
    const longer = recordDailySurvey(
      again,
      { ...base, wakeTime: "07:00", sleepHours: 8 },
      date,
      now,
    );
    expect(longer.experience - first.experience).toBe(20);
    const shorter = recordDailySurvey(
      longer,
      { ...base, wakeTime: "04:00", sleepHours: 5 },
      date,
      now,
    );
    expect(recordDailySurvey(shorter, base, date, now).experience).toBe(longer.experience);
    const over = recordDailySurvey(
      longer,
      { ...base, wakeTime: "09:00", sleepHours: 10 },
      date,
      now,
    );
    expect(over.experience).toBe(longer.experience);
    expect(dailySurveySchema.safeParse({ ...base, sleepHours: 10 }).success).toBe(false);
  });
  it("keeps zero sleep distinct from missing and never credits retired sleep rewards twice", () => {
    const zero = recordDailySurvey(
      initialGame(date),
      {
        ...surveyFixture(date),
        submittedAt: now,
        sleepStatus: "reported",
        sleepInputKind: "duration",
        bedtime: null,
        wakeTime: null,
        sleepHours: 0,
      },
      date,
      now,
    );
    expect(zero.healthHistory[date].sleepHours).toBe(0);
    expect(zero.sleepExperience[date]).toBeUndefined();
    const legacy = { ...initialGame(date), completed: ["sleep" as const], experience: 999 };
    expect(awardSleepExperience(legacy, 8, date)).toBe(legacy);
  });
  it("uses 90 percent of the reference retail price in whole RP", () => {
    expect(discountedRetailRp(11500)).toBe(10350);
    expect(discountedRetailRp(24300)).toBe(21870);
    expect(discountedRetailRp(-1)).toBe(0);
  });
});
