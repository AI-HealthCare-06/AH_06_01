import type { DailySurvey } from "./daily-survey";
export function surveyFixture(date: string): DailySurvey {
  return {
    date,
    submittedAt: new Date(date + "T00:00:00").getTime(),
    bloodPressureStatus: "not-measured",
    morning: null,
    evening: null,
    pulseStatus: "not-measured",
    restingHr: null,
    sleepStatus: "unknown",
    sleepHours: null,
    fastingGlucose: null,
    activeMinutes: null,
    sedentaryHours: null,
    snoring: null,
    daytimeSleepiness: null,
    nocturia: null,
  };
}
