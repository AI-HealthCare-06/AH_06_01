import { selectedDemoPersona } from "../domain/demo-personas";
import { demoMode, appStorageKey } from "../domain/demo-mode";
import { createDemoGame } from "../domain/demo-persona";
import { profileSchema } from "../domain/profile";
import { medicationListSchema, doseKey } from "../domain/medications";
import { localDate } from "../domain/calendar";
import { useGameStore } from "../stores/game-store";
import { useProfileStore } from "../stores/profile-store";
import { useMedicationStore } from "../stores/medication-store";

export function initializeDemoPersona() {
  if (!demoMode) return;
  const fixture = selectedDemoPersona();
  const today = localDate();
  const profile = profileSchema.parse(fixture.profile);
  useProfileStore.getState().setProfile(profile);
  useProfileStore.getState().completeOnboarding();
  const start = new Date(today + "T12:00:00");
  start.setDate(start.getDate() - (fixture.records.length - 1));
  useProfileStore.setState({ registeredOn: localDate(start) });
  localStorage.setItem(appStorageKey("rexrun-profile-registration-date"), localDate(start));
  const marker = appStorageKey("seed-date");
  const revision = `${today}:${fixture.revision}`;
  if (localStorage.getItem(marker) === revision) return;
  const game = createDemoGame(today, Date.now(), fixture);
  useGameStore.setState({ game, paused: false });
  useGameStore.getState().resumeSession();
  const medications = medicationListSchema.parse(fixture.medications);
  const taken = Object.fromEntries(
    (fixture.id === "htn-diabetes-v1"
      ? [
          ["demo-htn", "08:00"],
          ["demo-htn", "13:00"],
          ["demo-insulin", "08:00"],
        ]
      : []
    ).map(([id, time]) => [doseKey(today, id, time), true]),
  );
  useMedicationStore.getState().restore({ medications, taken, notificationsEnabled: false });
  localStorage.setItem(marker, revision);
}
