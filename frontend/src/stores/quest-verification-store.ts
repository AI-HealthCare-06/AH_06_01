import { useGameStore } from "./game-store";
import { create } from "zustand";
import { localDate } from "../domain/calendar";
import {
  selfReportedSleepMinutes,
  validQuestProof,
  type QuestProof,
} from "../domain/quest-verification";
import type { QuestId } from "../domain/game";
import type { MotionResult } from "../features/motion-capture/types";
import { motionConfig } from "../features/motion-capture/config";
import { useSessionStore } from "./session-store";

type VerificationState = {
  proofs: Partial<Record<QuestId, QuestProof>>;
  photo: (
    quest: "meal" | "medicine",
    image: string,
    capturedAt: number,
    doseKey?: string,
  ) => boolean;
  motion: (result: MotionResult) => boolean;
  sleep: (minutes: number, source: "health-connect" | "healthkit", date: string) => void;
  selfReportSleep: (hours: string, minutes: string, confirmed: boolean, date: string) => boolean;
  clearSleepReport: () => void;
  consume: (quest: QuestId, doseKey?: string) => boolean;
  reset: () => void;
};
const seenEvents = new Set<string>();

// Pending receipts belong to this signed-in session. Photos and video never enter storage.
export const useQuestVerificationStore = create<VerificationState>((set, get) => ({
  proofs: {},
  photo: (quest, image, capturedAt, doseKey) => {
    const now = Date.now();
    if (
      !useSessionStore.getState().active ||
      !/^data:image\/jpeg;base64,.{100,}$/.test(image) ||
      !Number.isFinite(capturedAt) ||
      capturedAt > now ||
      now - capturedAt > 30 * 60_000 ||
      localDate(new Date(capturedAt)) !== localDate() ||
      (quest === "medicine" && !doseKey)
    )
      return false;
    const event = `photo:${quest}:${capturedAt}:${doseKey || ""}`;
    if (seenEvents.has(event)) return false;
    seenEvents.add(event);
    const proof: QuestProof = {
      id: crypto.randomUUID(),
      quest,
      source: "camera-photo",
      date: localDate(),
      verifiedAt: now,
      ...(doseKey ? { doseKey } : {}),
    };
    set({ proofs: { ...get().proofs, [quest]: proof } });
    return true;
  },
  motion: (result) => {
    const ended = Date.parse(result.endedAt),
      now = Date.now();
    if (
      !useSessionStore.getState().active ||
      result.questId !== "water" ||
      result.verificationLevel !== "local_demo" ||
      !(
        result.detector === "rules_v1" ||
        (result.questId === "water" && result.detector === "drinking_rules_v2")
      ) ||
      result.inputSource !== "camera" ||
      result.decision !== "detected" ||
      !result.userConfirmed ||
      !result.eventId ||
      result.validObservationRatio < motionConfig.minimumValidRatio ||
      !Number.isFinite(ended) ||
      ended > now ||
      now - ended > 30 * 60_000 ||
      localDate(new Date(ended)) !== localDate()
    )
      return false;
    if (seenEvents.has(result.eventId)) return false;
    seenEvents.add(result.eventId);
    set({
      proofs: {
        ...get().proofs,
        water: {
          id: result.eventId,
          quest: "water",
          source: "camera-motion",
          date: localDate(),
          verifiedAt: ended,
        },
      },
    });
    return true;
  },
  sleep: (minutes, source, date) => {
    if (
      !useSessionStore.getState().active ||
      !["health-connect", "healthkit"].includes(source) ||
      date !== localDate() ||
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > 1440
    )
      return;
    useGameStore.getState().recordSleep(minutes, date);
    set({
      proofs: {
        ...get().proofs,
        sleep: {
          id: crypto.randomUUID(),
          quest: "sleep",
          source,
          date,
          verifiedAt: Date.now(),
          minutes,
        },
      },
    });
  },
  selfReportSleep: (hours, minutes, confirmed, date) => {
    const total = selfReportedSleepMinutes(hours, minutes);
    if (
      !useSessionStore.getState().active ||
      confirmed !== true ||
      date !== localDate() ||
      total === null
    )
      return false;
    useGameStore.getState().recordSleep(total, date);
    set({
      proofs: {
        ...get().proofs,
        sleep: {
          id: crypto.randomUUID(),
          quest: "sleep",
          source: "self-report",
          date,
          verifiedAt: Date.now(),
          minutes: total,
        },
      },
    });
    return true;
  },
  clearSleepReport: () => {
    if (get().proofs.sleep?.source !== "self-report") return;
    const proofs = { ...get().proofs };
    delete proofs.sleep;
    set({ proofs });
  },
  consume: (quest, doseKey) => {
    if (!validQuestProof(get().proofs[quest], quest, Date.now(), doseKey)) return false;
    const proofs = { ...get().proofs };
    delete proofs[quest];
    set({ proofs });
    return true;
  },
  reset: () => {
    seenEvents.clear();
    set({ proofs: {} });
  },
}));

useSessionStore.subscribe((next, previous) => {
  if (next !== previous) useQuestVerificationStore.getState().reset();
});
