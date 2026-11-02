import recorded from "../design/demo-quarter-analysis.json";
import { quarterDemoPersona } from "../domain/demo-personas";
import { createDemoGame } from "../domain/demo-persona";
import { profileSchema } from "../domain/profile";
import { medicationListSchema } from "../domain/medications";
import { demoAnalysisInputKey, DemoInputChangedError } from "../domain/demo-analysis-input";
import { questAnalysisSchema } from "../domain/quest-analysis";
import { useGameStore } from "../stores/game-store";
import { useProfileStore } from "../stores/profile-store";
import { useMedicationStore } from "../stores/medication-store";

// Replay only the exact seeded input. Edits must never inherit an old inference result.
export function replayQuarterAnalysis() {
  const game = useGameStore.getState().game;
  const baseline = createDemoGame(game.date, Date.now(), quarterDemoPersona);
  const current = demoAnalysisInputKey(
    useProfileStore.getState().profile,
    useMedicationStore.getState().medications,
    game,
  );
  const expected = demoAnalysisInputKey(
    profileSchema.parse(quarterDemoPersona.profile),
    medicationListSchema.parse(quarterDemoPersona.medications),
    baseline,
  );
  if (current !== expected) throw new DemoInputChangedError();
  const previous = new Date(game.date + "T12:00:00Z");
  previous.setUTCDate(previous.getUTCDate() - 1);
  return questAnalysisSchema.parse({
    ...recorded,
    as_of: game.date,
    daily_survey_date: game.date,
    previous_day: { ...recorded.previous_day, date: previous.toISOString().slice(0, 10) },
  });
}
