import { z } from "zod";
import { accessories } from "../design/accessories";
import { defaultDinosaurStyles, skinIds } from "./appearance";
import type { SkinId } from "./appearance";
import { calendarWeek, localDate } from "./calendar";
import {
  advanceCombat,
  battleBuffStats,
  combatSchema,
  initialCombat,
  migrateCombat,
} from "./battle";
import { experienceProgress, levelUpGold, questExperience } from "./experience";
import { effectCatalog, rpAllowance, rpPolicy } from "./economy";
import type { EffectId } from "./economy";

export const stepSnapshotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().nonnegative(),
  source: z.enum(["health-connect", "healthkit"]),
  syncedAt: z.number().finite().nonnegative(),
});
export type StepSnapshot = z.infer<typeof stepSnapshotSchema>;

export const questIds = ["medicine", "meal", "walk", "water", "sleep"] as const;
export type QuestId = (typeof questIds)[number];
export type Quest = {
  id: QuestId;
  title: string;
  shortTitle: string;
  progress: number;
  progressLabel: string;
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
    experience: 20,
    reason: "복용 중이라고 설정한 약을 잊지 않도록 알려주는 체크예요.",
  },
  {
    id: "meal",
    title: "건강한 식사하기",
    shortTitle: "건강한 식사",
    progress: 1,
    progressLabel: "오전 8:30 · 완료",
    experience: 30,
    reason: "오늘의 식사 습관을 확인하고 꾸준히 기록해요.",
  },
  {
    id: "walk",
    title: "6,000걸음 걷기",
    shortTitle: "6,000걸음",
    progress: 0.54,
    progressLabel: "3,240 / 6,000걸음",
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
    experience: 30,
    reason: "오늘의 물 마시기 실천을 기록해요. 개인별 안내에 맞춰 실천해 주세요.",
  },
  {
    id: "sleep",
    title: "수면 7시간 달성",
    shortTitle: "수면",
    progress: 370 / 420,
    progressLabel: "6시간 10분",
    experience: 40,
    reason: "어젯밤의 수면을 돌아보고 일정한 수면 습관을 기록해요.",
  },
];

export const gameSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    completed: z.array(z.enum(questIds)),
    coins: z.number().int().nonnegative().optional(),
    experience: z.number().int().nonnegative().optional(),
    gold: z.number().int().nonnegative().default(0),
    rp: z.number().int().nonnegative().default(0),
    rpLedger: z
      .array(z.object({ date: z.string(), amount: z.number().int().positive() }))
      .default([]),
    activity: z.partialRecord(z.enum(questIds), z.number().int().nonnegative()).default({}),
    firstQuestExp: z.partialRecord(z.enum(questIds), z.number().int().nonnegative()).default({}),
    lastWaterAt: z.number().nullable().default(null),
    sleepHours: z.number().min(0).max(24).nullable().default(null),
    hydrationRatio: z.number().nonnegative().nullable().default(null),
    combat: combatSchema.optional(),
    battleUpdatedAt: z.number().nonnegative().default(0),
    battlePaused: z.boolean().default(false),
    ownedEffects: z.array(z.enum(["original", "emerald", "violet"])).default(["original"]),
    battleEffect: z.enum(["original", "emerald", "violet"]).default("original"),
    ownedAccessories: z.array(z.string()).default([]),
    equippedAccessories: z
      .object({ head: z.string().nullable(), pet: z.string().nullable() })
      .default({ head: null, pet: null }),
    bonusClaimed: z.boolean(),
    allDoneBonusClaimed: z.boolean(),
    sampleDay: z.boolean().default(true),
    steps: stepSnapshotSchema.nullable().default(null),
    completedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
    battleDefeats: z.number().int().nonnegative().default(0),
    dinosaur: z.number().int().min(0).max(5),
    dinosaurStyles: z
      .array(z.enum(skinIds))
      .length(6)
      .default(defaultDinosaurStyles)
      .catch(defaultDinosaurStyles),
    lastReward: z
      .object({
        questId: z.enum(questIds),
        coins: z.number().int().nonnegative().optional(),
        gold: z.number().int().nonnegative().default(0),
        experience: z.number().int().nonnegative().default(0),
      })
      .transform(({ coins, ...reward }) => ({ ...reward, gold: reward.gold + (coins ?? 0) }))
      .nullable(),
  })
  .transform(({ coins, ...state }) => ({
    ...state,
    version: 2 as const,
    // Version 1 kept two balances. Canonical saves omit coins, so repeated loads
    // cannot credit the legacy balance twice (even after spending the Gold).
    gold: state.gold + (state.version === 1 ? (coins ?? 0) : 0),
  }));
export type GameState = Omit<z.infer<typeof gameSchema>, "experience" | "combat"> & {
  experience: number;
  combat: z.infer<typeof combatSchema>;
};

export function seoulDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function initialGame(date = localDate()): GameState {
  return {
    version: 2,
    date,
    completed: [],
    experience: 0,
    gold: 1280,
    rp: 0,
    rpLedger: [],
    activity: {},
    firstQuestExp: {},
    lastWaterAt: null,
    sleepHours: null,
    hydrationRatio: null,
    combat: initialCombat(),
    battleUpdatedAt: Date.now(),
    battlePaused: false,
    ownedEffects: ["original"],
    battleEffect: "original",
    ownedAccessories: [],
    equippedAccessories: { head: null, pet: null },
    bonusClaimed: false,
    allDoneBonusClaimed: false,
    sampleDay: false,
    steps: null,
    completedDates: [],
    battleDefeats: 0,
    dinosaur: 0,
    dinosaurStyles: defaultDinosaurStyles(),
    lastReward: null,
  };
}

export function rollDay(state: GameState, date = localDate()): GameState {
  if (state.date === date) return state;
  return {
    ...state,
    date,
    completed: [],
    bonusClaimed: false,
    allDoneBonusClaimed: false,
    sampleDay: false,
    steps: null,
    activity: {},
    firstQuestExp: {},
    sleepHours: null,
    hydrationRatio: null,
    lastReward: null,
  };
}

export function purchaseAccessory(state: GameState, id: string): GameState {
  const item = accessories.find((item) => item.id === id);
  if (!item || state.ownedAccessories.includes(id) || state.gold < item.price) return state;
  return {
    ...state,
    gold: state.gold - item.price,
    ownedAccessories: [...state.ownedAccessories, id],
  };
}

export function equipAccessory(state: GameState, id: string): GameState {
  const item = accessories.find((item) => item.id === id);
  if (!item || !state.ownedAccessories.includes(id)) return state;
  return {
    ...state,
    equippedAccessories: {
      ...state.equippedAccessories,
      [item.category]: state.equippedAccessories[item.category] === id ? null : id,
    },
  };
}

export function completeQuest(
  state: GameState,
  id: QuestId,
  date = localDate(),
  now = Date.now(),
): GameState {
  const current = rollDay(state, date);
  if (current.completed.includes(id)) return current;
  if (id === "walk" && (!current.steps || current.steps.count < 6000)) return current;
  if (id === "water" && current.lastWaterAt !== null && now - current.lastWaterAt < 7_200_000)
    return current;
  const quest = quests.find((item) => item.id === id);
  if (!quest) throw new Error("존재하지 않는 퀘스트입니다.");
  const completed = [...current.completed, id];
  const allDone = completed.length === quests.length;
  const gained = questExperience(quest.experience, current.experience);
  const experience = current.experience + gained;
  const gold = levelUpGold(current.experience, experience);
  return {
    ...current,
    completed,
    gold: current.gold + gold,
    experience,
    activity: { ...current.activity, [id]: 1 },
    firstQuestExp: { ...current.firstQuestExp, [id]: gained },
    lastWaterAt: id === "water" ? now : current.lastWaterAt,
    allDoneBonusClaimed: allDone || current.allDoneBonusClaimed,
    completedDates:
      allDone && !current.sampleDay
        ? [...new Set([...current.completedDates, date])].slice(-365)
        : current.completedDates,
    lastReward: { questId: id, gold, experience: gained },
  };
}

export function claimDailyBonus(state: GameState, date = localDate()): GameState {
  const current = rollDay(state, date);
  return current.bonusClaimed
    ? current
    : { ...current, gold: current.gold + 10, bonusClaimed: true };
}

export function applyDinosaurStyle(state: GameState, index: number, skin: SkinId): GameState {
  if (!Number.isInteger(index) || index < 0 || index >= 6 || !skinIds.includes(skin)) return state;
  return {
    ...state,
    dinosaur: index,
    dinosaurStyles: state.dinosaurStyles.map((current, i) => (i === index ? skin : current)),
  };
}

export function restoreGame(value: unknown): GameState {
  const result = gameSchema.safeParse(value);
  if (!result.success) return initialGame();
  const completed = [...new Set(result.data.completed)];
  // Older saves only retain the last day's individual completions. Credit those
  // known rewards once; never invent EXP for historical or sampled activity.
  const experience =
    result.data.experience ??
    (result.data.sampleDay
      ? 0
      : quests.reduce(
          (total, quest) => total + (completed.includes(quest.id) ? quest.experience : 0),
          0,
        ));
  const combat =
    result.data.combat ??
    migrateCombat(result.data.battleDefeats, experienceProgress(experience).level);
  // The store ticks this snapshot before rolling its day, so offline combat uses
  // yesterday's buffs only up to midnight. Parsing itself never grants currency.
  return { ...result.data, completed, experience, combat };
}

export function stageProgress(game: GameState): number {
  const sum = quests.reduce((total, q) => total + questProgress(game, q), 0);
  return Math.floor((sum / quests.length) * 10);
}

export function questProgress(game: GameState, quest: Quest): number {
  if (quest.id === "walk")
    return game.completed.includes("walk") ? 1 : Math.min(1, (game.steps?.count ?? 0) / 6000);
  return game.completed.includes(quest.id)
    ? 1
    : game.sampleDay && quest.progress < 1
      ? quest.progress
      : 0;
}

export function questProgressLabel(game: GameState, quest: Quest): string {
  if (quest.id === "walk")
    return `${(game.steps?.count ?? 0).toLocaleString("ko-KR")} / 6,000걸음${game.completed.includes("walk") ? " · 완료" : ""}`;
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

export function syncDeviceSteps(state: GameState, value: unknown, today = localDate()): GameState {
  const parsed = stepSnapshotSchema.safeParse(value);
  if (!parsed.success || parsed.data.date !== today) return state;
  const current = rollDay(state, today);
  const snapshot = parsed.data;
  if (current.steps && snapshot.syncedAt < current.steps.syncedAt) return current;
  const next = { ...current, steps: snapshot };
  return snapshot.count >= 6000 ? completeQuest(next, "walk", today) : next;
}

export function weeklyCompletedDays(game: GameState): number {
  const week = new Set(calendarWeek(game.date).map((day) => day.date));
  return Math.min(
    5,
    new Set(game.completedDates.filter((date) => week.has(date) && date <= game.date)).size,
  );
}

export function tickBattle(state: GameState, now = Date.now()): GameState {
  if (now <= state.battleUpdatedAt) return state;
  if (state.battlePaused || !state.battleUpdatedAt)
    return { ...rollDay(state, localDate(new Date(now))), battleUpdatedAt: now };
  // Full-rate offline simulation up to 24 hours, with buffs expiring at midnight.
  let current = state;
  let cursor = Math.max(state.battleUpdatedAt, now - 86_400_000);
  while (cursor < now) {
    const date = localDate(new Date(cursor));
    current = rollDay(current, date);
    const midnight = new Date(cursor);
    midnight.setHours(24, 0, 0, 0);
    const end = Math.min(now, midnight.getTime());
    const result = advanceCombat(
      current.combat,
      battleBuffStats(current),
      experienceProgress(current.experience).level,
      end - cursor,
    );
    current = {
      ...current,
      combat: result.combat,
      gold: current.gold + result.gold,
      battleDefeats: current.battleDefeats + result.defeats,
    };
    cursor = end;
  }
  return { ...rollDay(current, localDate(new Date(now))), battleUpdatedAt: now };
}

export function convertDemoRp(state: GameState, requested: number, date = localDate()): GameState {
  if (!Number.isSafeInteger(requested) || requested <= 0) return state;
  const current = rollDay(state, date);
  const maximum = Math.min(
    Math.floor(current.gold / rpPolicy.goldPerRp),
    rpAllowance(current.rpLedger, date).available,
  );
  if (requested > maximum) return current;
  const today = current.rpLedger.find((entry) => entry.date === date);
  const rpLedger = current.rpLedger.filter((entry) => entry.date !== date);
  rpLedger.push({ date, amount: requested + (today?.amount ?? 0) });
  return {
    ...current,
    gold: current.gold - requested * rpPolicy.goldPerRp,
    rp: current.rp + requested,
    rpLedger,
  };
}

export function purchaseEffect(state: GameState, id: EffectId): GameState {
  const item = effectCatalog.find((effect) => effect.id === id);
  if (!item) return state;
  if (state.ownedEffects.includes(id)) return { ...state, battleEffect: id };
  if (state.gold < item.price) return state;
  return {
    ...state,
    gold: state.gold - item.price,
    ownedEffects: [...state.ownedEffects, id],
    battleEffect: id,
  };
}

export function repeatDemoQuest(state: GameState, id: QuestId, now = Date.now()): GameState {
  const current = rollDay(state, localDate(new Date(now)));
  // Repeat medicine requires registered schedules; sensors own walking/sleep.
  if ((id !== "meal" && id !== "water") || !current.completed.includes(id)) return current;
  const count = current.activity[id] ?? 1;
  if (
    count >= 6 ||
    (id === "water" && current.lastWaterAt !== null && now - current.lastWaterAt < 120 * 60_000)
  )
    return current;
  const first =
    current.firstQuestExp[id] ??
    questExperience(quests.find((q) => q.id === id)!.experience, current.experience);
  const gained = Math.floor(first * 0.1);
  const experience = current.experience + gained;
  const gold = levelUpGold(current.experience, experience);
  return {
    ...current,
    experience,
    gold: current.gold + gold,
    activity: { ...current.activity, [id]: count + 1 },
    lastWaterAt: id === "water" ? now : current.lastWaterAt,
    lastReward: { questId: id, gold, experience: gained },
  };
}
