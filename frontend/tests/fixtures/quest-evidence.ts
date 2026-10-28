import type { Page } from "@playwright/test";

// Synthetic receipts for reward/layout regressions; real photo UI is covered by quest-verification.spec.
export async function authenticateQuest(page: Page, quest: "meal" | "water") {
  await page.evaluate(async (quest) => {
    const path = "/src/stores/quest-verification-store.ts";
    const { useQuestVerificationStore } = await import(path);
    if (quest === "meal")
      useQuestVerificationStore
        .getState()
        .photo("meal", "data:image/jpeg;base64," + "A".repeat(200), Date.now());
    else
      useQuestVerificationStore.getState().motion({
        questId: "water",
        inputSource: "camera",
        decision: "detected",
        userConfirmed: true,
        eventId: crypto.randomUUID(),
        endedAt: new Date().toISOString(),
        validObservationRatio: 1,
        detector: "rules_v1",
        verificationLevel: "local_demo",
      });
  }, quest);
}

export async function authenticateDose(page: Page, time: string) {
  await page.evaluate(async (time) => {
    const path = "/src/stores/quest-verification-store.ts";
    const medsPath = "/src/stores/medication-store.ts";
    const { useQuestVerificationStore } = await import(path);
    const { useMedicationStore } = await import(medsPath);
    const med = useMedicationStore
      .getState()
      .medications.find((m: { times: string[] }) => m.times.includes(time));
    const date = new Date().toLocaleDateString("en-CA");
    useQuestVerificationStore
      .getState()
      .photo(
        "medicine",
        "data:image/jpeg;base64," + "A".repeat(200),
        Date.now(),
        `${date}|${med.id}|${time}`,
      );
  }, time);
}
