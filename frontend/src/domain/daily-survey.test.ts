import { describe, it, expect } from "vitest";
import {
  initialGame,
  recordDailySurvey,
  rollDay,
  mainQuestCount,
  completeQuest,
  restoreGame,
} from "./game";
import { localDate } from "./calendar";
import { healthSnapshotKey } from "./bp-stage";
import { initialProfile } from "./profile";
const now = new Date(2026, 9, 27, 12).getTime(),
  date = localDate(new Date(now));
const survey = {
  date,
  submittedAt: now,
  bloodPressureStatus: "measured",
  morning: { systolic: 148, diastolic: 94 },
  evening: null,
  pulseStatus: "measured",
  restingHr: 78,
  sleepStatus: "reported",
  sleepHours: 5.5,
  fastingGlucose: 154,
  activeMinutes: 0,
  sedentaryHours: 8,
  snoring: false,
  daytimeSleepiness: null,
  nocturia: false,
};
describe("daily health survey", () => {
  it("stores dated measurements and gives its reward only once while allowing corrections", () => {
    const state = initialGame(date);
    const first = recordDailySurvey(state, survey, date, now);
    expect(first.completed).toEqual(["survey"]);
    expect(first.healthHistory[date]).toMatchObject({
      systolic: 148,
      diastolic: 94,
      restingHr: 78,
      glucose: 154,
      sleepHours: 5.5,
    });
    const edited = recordDailySurvey(
      first,
      { ...survey, evening: { systolic: 142, diastolic: 90 } },
      date,
      now,
    );
    expect(edited.healthHistory[date].systolic).toBe(142);
    expect(edited.experience).toBe(first.experience);
    expect(edited.gold).toBe(first.gold);
    const tomorrow = rollDay(edited, "2026-10-28");
    expect(tomorrow.dailySurveys[date]).toEqual(edited.dailySurveys[date]);
    expect(tomorrow.completed).not.toContain("survey");
  });
  it("rejects inconsistent pairs and stale/future submissions without inventing values", () => {
    const state = initialGame(date);
    expect(
      recordDailySurvey(state, { ...survey, morning: { systolic: 80, diastolic: 90 } }, date, now),
    ).toBe(state);
    expect(recordDailySurvey(state, { ...survey, date: "2026-10-26" }, date, now)).toBe(state);
    expect(recordDailySurvey(state, { ...survey, submittedAt: now + 1 }, date, now)).toBe(state);
    expect(completeQuest(state, "survey", date, now)).toBe(state);
    const unknown = recordDailySurvey(
      state,
      {
        ...survey,
        bloodPressureStatus: "not-measured",
        morning: null,
        pulseStatus: "not-measured",
        restingHr: null,
        sleepStatus: "unknown",
        sleepHours: null,
        fastingGlucose: null,
      },
      date,
      now,
    );
    expect(unknown.healthHistory[date]).toMatchObject({
      systolic: null,
      diastolic: null,
      glucose: null,
      sleepHours: null,
    });
    expect(unknown.completed).toContain("survey");
  });
  it("excludes water from main progress and completes all four main quests without it", () => {
    let state = recordDailySurvey(initialGame(date), survey, date, now);
    state.steps = { date, count: 6000, source: "healthkit", syncedAt: now };
    for (const q of ["medicine", "meal", "walk"] as const)
      state = completeQuest(state, q, date, now);
    expect(state.completed).not.toContain("water");
    expect(mainQuestCount(state.completed)).toBe(4);
    expect(state.allDoneBonusClaimed).toBe(true);
    expect(state.completedDates).toContain(date);
    const water = completeQuest(state, "water", date, now);
    expect(mainQuestCount(water.completed)).toBe(4);
    expect(water.questHistory[date]).toBe(4);
  });
  it("preserves legacy balances and refreshes model keys for daily values without combat ticks", () => {
    const legacy = { ...initialGame(date), experience: 9999, gold: 7777 };
    delete (legacy as { dailySurveys?: unknown }).dailySurveys;
    const legacyComplete = {
      ...legacy,
      completed: ["medicine", "meal", "walk", "water", "sleep"],
      allDoneBonusClaimed: true,
    };
    expect(rollDay(restoreGame(legacyComplete), "2026-10-28").questHistory[date]).toBe(5);
    expect(restoreGame(legacy)).toMatchObject({ experience: 9999, gold: 7777, dailySurveys: {} });
    const before = healthSnapshotKey(initialProfile, [], initialGame(date));
    const next = recordDailySurvey(initialGame(date), survey, date, now);
    const key = healthSnapshotKey(initialProfile, [], next);
    expect(key).not.toBe(before);
    const cosmeticChange = { ...next, gold: 0 };
    expect(healthSnapshotKey(initialProfile, [], cosmeticChange)).toBe(key);
  });
});
