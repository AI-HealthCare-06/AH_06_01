import { selectedDemoPersona } from "../domain/demo-personas";
import { demoMode, appStorageKey } from "../domain/demo-mode";
import { createDemoGame } from "../domain/demo-persona";
import { profileSchema } from "../domain/profile";
import { medicationListSchema, doseKey } from "../domain/medications";
import { localDate } from "../domain/calendar";
import { useGameStore } from "../stores/game-store";
import { useProfileStore } from "../stores/profile-store";
import { useMedicationStore } from "../stores/medication-store";
import { dietOwner, useDietStore } from "../stores/diet-store";
import { mealRecordSchema } from "../domain/diet";

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
      : fixture.id === "studio-quarter-v1" && fixture.records.at(-1)?.completed.includes("medicine")
        ? medications.flatMap((m) => m.times.map((time) => [m.id, time]))
        : []
    ).map(([id, time]) => [doseKey(today, id, time), true]),
  );
  useMedicationStore.getState().restore({ medications, taken, notificationsEnabled: false });
  if (fixture.id === "studio-quarter-v1") {
    const owner = dietOwner();
    if (owner) {
      const records = fixture.records
        .flatMap((row, index) => {
          const day = new Date(today + "T12:00:00");
          day.setDate(day.getDate() - (fixture.records.length - 1 - index));
          const date = localDate(day);
          return (row.meals ?? []).map((meal, n) =>
            mealRecordSchema.parse({
              id: `quarter-${date}-${n}`,
              date,
              slot: meal.slot,
              source: "manual",
              catalogVersion: "f6-dev-sample-v1",
              model: null,
              createdAt: day.toISOString(),
              items: [
                {
                  id: `quarter-item-${index}-${n}`,
                  name: meal.name,
                  nameInput: meal.name,
                  foodCode: null,
                  grams: String(meal.grams),
                  estimatedGrams: null,
                  confidence: null,
                  portionHint: "시연용 합성 영양 기록",
                  isSoup: false,
                  suggestedCode: null,
                  nutrients: meal.nutrients,
                },
              ],
            }),
          );
        })
        .reverse();
      localStorage.setItem(
        appStorageKey("rexrun-diet-records-v1") + ":" + owner,
        JSON.stringify(records),
      );
      useDietStore.getState().refresh();
    }
  }
  localStorage.setItem(marker, revision);
}
