import { z } from "zod";

export const questIds = ["medicine", "meal", "walk", "water", "sleep"] as const;
export type QuestId = (typeof questIds)[number];
export type Quest = {
  id: QuestId;
  title: string;
  shortTitle: string;
  progress: number;
  progressLabel: string;
  reward: number;
  experience: number;
  reason: string;
};

export const quests: Quest[] = [
  {
    id: "medicine",
    title: "약 복용하기",
    shortTitle: "약 복용",
    progress: 1,
    progressLabel: "오전 8:00 · 완료",
    reward: 10,
    experience: 20,
    reason: "복용 중이라고 설정한 약을 잊지 않도록 알려주는 체크예요.",
  },
  {
    id: "meal",
    title: "건강한 식사하기",
    shortTitle: "건강한 식사",
    progress: 1,
    progressLabel: "오전 8:30 · 완료",
    reward: 20,
    experience: 30,
    reason: "오늘의 식사 습관을 확인하고 꾸준히 기록해요.",
  },
  {
    id: "walk",
    title: "6,000걸음 걷기",
    shortTitle: "6,000걸음",
    progress: 0.54,
    progressLabel: "3,240 / 6,000걸음",
    reward: 30,
    experience: 50,
    reason:
      "꾸준한 걷기는 혈압과 혈당 관리에 도움이 되고, 오늘의 위험도를 낮추는 가장 쉬운 시작이에요.",
  },
  {
    id: "water",
    title: "물 8잔 마시기",
    shortTitle: "물 마시기",
    progress: 0,
    progressLabel: "0 / 8잔",
    reward: 20,
    experience: 30,
    reason: "오늘의 물 마시기 실천을 기록해요. 개인별 안내에 맞춰 실천해 주세요.",
  },
  {
    id: "sleep",
    title: "수면 7시간 달성",
    shortTitle: "수면",
    progress: 370 / 420,
    progressLabel: "6시간 10분",
    reward: 20,
    experience: 40,
    reason: "어젯밤의 수면을 돌아보고 일정한 수면 습관을 기록해요.",
  },
];

export const gameSchema = z.object({
  version: z.literal(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completed: z.array(z.enum(questIds)),
  coins: z.number().int().nonnegative(),
  bonusClaimed: z.boolean(),
  allDoneBonusClaimed: z.boolean(),
  sampleDay: z.boolean().default(true),
  dinosaur: z.number().int().min(0).max(5),
  lastReward: z
    .object({ questId: z.enum(questIds), coins: z.number().int().nonnegative() })
    .nullable(),
});
export type GameState = z.infer<typeof gameSchema>;

export function seoulDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function initialGame(date = seoulDate()): GameState {
  return {
    version: 1,
    date,
    completed: ["medicine", "meal"],
    coins: 1280,
    bonusClaimed: false,
    allDoneBonusClaimed: false,
    sampleDay: true,
    dinosaur: 0,
    lastReward: null,
  };
}

export function rollDay(state: GameState, date = seoulDate()): GameState {
  if (state.date === date) return state;
  return {
    ...state,
    date,
    completed: [],
    bonusClaimed: false,
    allDoneBonusClaimed: false,
    sampleDay: false,
    lastReward: null,
  };
}

export function completeQuest(state: GameState, id: QuestId, date = seoulDate()): GameState {
  const current = rollDay(state, date);
  if (current.completed.includes(id)) return current;
  const quest = quests.find((item) => item.id === id);
  if (!quest) throw new Error("존재하지 않는 퀘스트입니다.");
  const completed = [...current.completed, id];
  const allDone = completed.length === quests.length;
  const bonus =
    allDone && !current.allDoneBonusClaimed
      ? quests.reduce((sum, item) => sum + item.reward, 0) / 2
      : 0;
  return {
    ...current,
    completed,
    coins: current.coins + quest.reward + bonus,
    allDoneBonusClaimed: allDone || current.allDoneBonusClaimed,
    lastReward: { questId: id, coins: quest.reward + bonus },
  };
}

export function claimDailyBonus(state: GameState, date = seoulDate()): GameState {
  const current = rollDay(state, date);
  return current.bonusClaimed
    ? current
    : { ...current, coins: current.coins + 10, bonusClaimed: true };
}

export function restoreGame(value: unknown): GameState {
  const result = gameSchema.safeParse(value);
  return result.success
    ? rollDay({ ...result.data, completed: [...new Set(result.data.completed)] })
    : initialGame();
}

export function stageProgress(game: GameState): number {
  const sum = quests.reduce((total, q) => total + questProgress(game, q), 0);
  return Math.floor((sum / quests.length) * 10);
}

export function questProgress(game: GameState, quest: Quest): number {
  return game.completed.includes(quest.id)
    ? 1
    : game.sampleDay && quest.progress < 1
      ? quest.progress
      : 0;
}

export function questProgressLabel(game: GameState, quest: Quest): string {
  if (game.completed.includes(quest.id))
    return game.sampleDay && quest.progress === 1 ? quest.progressLabel : "완료";
  if (game.sampleDay && quest.progress < 1) return quest.progressLabel;
  return {
    medicine: "미완료",
    meal: "미완료",
    walk: "0 / 6,000걸음",
    water: "0 / 8잔",
    sleep: "0시간 / 7시간",
  }[quest.id];
}
