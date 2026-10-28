import fixture from "../design/demo-persona.json";
import { dailySurveySchema } from "./daily-survey";
import { completeQuest, initialGame, recordDailySurvey, rollDay, type QuestId } from "./game";
import { localDate } from "./calendar";
import { experienceForLevel, experienceProgress } from "./experience";
import { initialCombat } from "./battle";
import { characterStats } from "./game-policy";

// Only the isolated synthetic persona uses this seed; signed-in saves never do.
export function createDemoGame(today = localDate(), now = Date.now()) {
  let game = initialGame(today);
  game.experience = experienceForLevel(6) + 40;
  game.gold = 3200;
  fixture.records.forEach((record, index) => {
    const day = new Date(today + "T12:00:00");
    day.setDate(day.getDate() - (fixture.records.length - 1 - index));
    const date = localDate(day);
    const submittedAt = Math.min(day.getTime(), now);
    game = index === 0 ? { ...game, date } : rollDay(game, date);
    game.steps = { date, count: record.steps, source: "health-connect", syncedAt: submittedAt };
    for (const id of record.completed) game = completeQuest(game, id as QuestId, date, submittedAt);
    const survey = dailySurveySchema.parse({
      ...record.survey,
      date,
      submittedAt,
      bloodPressureStatus: "measured",
      morning: { systolic: record.systolic, diastolic: record.diastolic },
      evening: null,
      pulseStatus: "measured",
      restingHr: record.restingHr,
      sleepStatus: "reported",
      sleepInputKind: "times",
      sleepHours: record.sleepHours,
      fastingGlucose: record.glucose,
      snoring: record.survey.snoringScore > 0,
      daytimeSleepiness: record.survey.daytimeSleepinessScore > 0,
    });
    game = recordDailySurvey(game, survey, date, submittedAt);
  });
  game.combat = {
    ...initialCombat(characterStats(experienceProgress(game.experience).level).hp),
    stage: 2,
  };
  return game;
}
