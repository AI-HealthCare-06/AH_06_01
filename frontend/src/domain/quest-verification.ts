import { localDate } from "./calendar";
import type { GameState, QuestId } from "./game";

export type QuestProof = {
  id: string;
  quest: "medicine" | "meal" | "water" | "sleep";
  source: "camera-photo" | "camera-motion" | "health-connect" | "healthkit" | "self-report";
  date: string;
  verifiedAt: number;
  doseKey?: string;
  minutes?: number;
};

export function selfReportedSleepMinutes(hours: string, minutes: string) {
  if (!/^\d{1,2}$/.test(hours) || !/^\d{1,2}$/.test(minutes)) return null;
  const h = Number(hours),
    m = Number(minutes);
  const total = h * 60 + m;
  return h <= 24 && m <= 59 && total > 0 && total <= 1440 ? total : null;
}

export function validQuestProof(
  proof: QuestProof | undefined,
  quest: QuestId,
  now = Date.now(),
  doseKey?: string,
) {
  if (
    !proof ||
    proof.quest !== quest ||
    !proof.id ||
    proof.date !== localDate(new Date(now)) ||
    !Number.isFinite(proof.verifiedAt) ||
    proof.verifiedAt > now ||
    now - proof.verifiedAt > 30 * 60_000
  )
    return false;
  if (quest === "medicine")
    return proof.source === "camera-photo" && !!doseKey && proof.doseKey === doseKey;
  if (quest === "meal") return proof.source === "camera-photo";
  if (quest === "water") return proof.source === "camera-motion";
  return (
    quest === "sleep" &&
    ["health-connect", "healthkit", "self-report"].includes(proof.source) &&
    Number.isInteger(proof.minutes) &&
    proof.minutes! >= 420 &&
    proof.minutes! <= 1440
  );
}

export function questVerified(
  game: GameState,
  quest: QuestId,
  proof: QuestProof | undefined,
  doses: { taken: boolean }[] = [],
  now = Date.now(),
) {
  if (quest === "survey") return !!game.dailySurveys[localDate(new Date(now))];
  if (quest === "medicine") return doses.length > 0 && doses.every((dose) => dose.taken);
  if (quest === "walk")
    return game.steps?.date === localDate(new Date(now)) && game.steps.count >= 6000;
  return validQuestProof(proof, quest, now);
}
