import { describe, expect, it } from "vitest";
import { officeMonthPersona } from "./demo-personas";
import { createDemoGame } from "./demo-persona";
import { profileSchema } from "./profile";
import { recordDailySurvey, restoreGame } from "./game";
import { sleepHoursFromTimes, validDailySurvey } from "./daily-survey";

const today = "2026-10-29";
const now = new Date(today + "T12:00:00").getTime();

describe("source document office persona month", () => {
  it("preserves known baseline facts and leaves unspecified measurements unknown", () => {
    const profile = profileSchema.parse(officeMonthPersona.profile);
    expect(profile).toMatchObject({
      age: 42,
      sex: "male",
      height: 175,
      weight: 78,
      waistCm: 92,
      bloodPressure: "138 / 89",
      htnStatus: "none",
      conditions: [],
      smoking: false,
      glucose: null,
      restingHeartRate: null,
    });
    expect(officeMonthPersona.medications).toEqual([]);
  });
  it("creates thirty valid daily surveys and actual quest-derived rewards without inventing medicine use", () => {
    const game = createDemoGame(today, now, officeMonthPersona);
    const dates = Object.keys(game.dailySurveys);
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-09-30");
    expect(dates.at(-1)).toBe(today);
    for (const date of dates) {
      const survey = game.dailySurveys[date];
      expect(validDailySurvey(survey, date, now)).not.toBeNull();
      expect(sleepHoursFromTimes(survey.bedtime, survey.wakeTime)).toBeCloseTo(survey.sleepHours!);
      expect(survey).toMatchObject({
        pulseStatus: "not-measured",
        restingHr: null,
        fastingGlucose: null,
        snoring: null,
        daytimeSleepiness: null,
      });
      expect(game.questHistoryDetails[date]).not.toContain("medicine");
      expect(game.questHistoryDetails[date].includes("walk")).toBe(
        game.healthHistory[date].steps! >= 6000,
      );
      expect(game.sleepExperience[date].experience).toBeGreaterThan(0);
    }
    expect(game.profileQuests.completed.conditions?.experience).toBe(200);
    expect(game.profileQuests.completed.lifestyle?.experience).toBe(200);
    const restored = restoreGame(JSON.parse(JSON.stringify(game)));
    const repeated = recordDailySurvey(restored, restored.dailySurveys[today], today, now);
    expect(repeated.experience).toBe(game.experience);
    expect(repeated.gold).toBe(game.gold);
  });
  it("contains the scenario's rise and sustained lower BP periods as input records only", () => {
    const records = officeMonthPersona.records;
    expect(records[0]).toMatchObject({ systolic: 133, diastolic: 84 });
    expect(records.slice(7, 14).every((r) => r.systolic >= 137 && r.diastolic >= 86)).toBe(true);
    expect(
      records
        .slice(14, 28)
        .every((r) => r.systolic >= 129 && r.systolic <= 131 && r.diastolic === 80),
    ).toBe(true);
    expect(records.every((record) => !Object.hasOwn(record, "stage"))).toBe(true);
  });
});
