import { z } from "zod";
import type { GameState } from "./game";
import { levelUpGold } from "./experience";

export const profileQuestIds = ["conditions", "lifestyle"] as const;
export type ProfileQuestId = (typeof profileQuestIds)[number];
export const profileQuestWindow = 7 * 24 * 60 * 60 * 1000;
export const profileQuests = [
  {
    id: "conditions",
    title: "지병 기록하기",
    description: "지병·치료 이력과 복용 중인 약을 기록해요.",
    experience: 200,
  },
  {
    id: "lifestyle",
    title: "생활습관 기록하기",
    description: "흡연·음주·활동과 가족력을 기록해요.",
    experience: 200,
  },
] as const;
export const profileQuestSchema = z.object({
  startedAt: z.number().int().nonnegative().nullable(),
  completed: z.partialRecord(
    z.enum(profileQuestIds),
    z.object({
      completedAt: z.number().int().nonnegative(),
      experience: z.number().int().nonnegative().max(200),
    }),
  ),
});
export type ProfileQuestProgress = z.infer<typeof profileQuestSchema>;
export const emptyProfileQuests = (): ProfileQuestProgress => ({ startedAt: null, completed: {} });
export function profileQuestStatus(
  progress: ProfileQuestProgress,
  id: ProfileQuestId,
  now: number,
) {
  if (progress.completed[id]) return "completed";
  if (progress.startedAt === null || now < progress.startedAt) return "not-started";
  return now < progress.startedAt + profileQuestWindow ? "available" : "expired";
}
export function startProfileQuests(state: GameState, now: number, legacy = false): GameState {
  if (state.profileQuests.startedAt !== null || !Number.isSafeInteger(now) || now < 0) return state;
  return {
    ...state,
    profileQuests: {
      startedAt: now,
      completed: legacy
        ? {
            conditions: { completedAt: now, experience: 0 },
            lifestyle: { completedAt: now, experience: 0 },
          }
        : {},
    },
  };
}
export function completeProfileQuest(state: GameState, id: ProfileQuestId, now: number): GameState {
  const status = profileQuestStatus(state.profileQuests, id, now);
  if (status === "not-started" || status === "completed" || !Number.isSafeInteger(now))
    return state;
  const reward = status === "available" ? profileQuests.find((q) => q.id === id)!.experience : 0;
  const experience = state.experience + reward;
  return {
    ...state,
    experience,
    gold: state.gold + levelUpGold(state.experience, experience),
    profileQuests: {
      ...state.profileQuests,
      completed: {
        ...state.profileQuests.completed,
        [id]: { completedAt: now, experience: reward },
      },
    },
  };
}
export function profileQuestDeadline(progress: ProfileQuestProgress) {
  return progress.startedAt === null
    ? null
    : new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
      }).format(progress.startedAt + profileQuestWindow);
}
