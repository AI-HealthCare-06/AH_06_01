import { z } from "zod";
import { profileQuestSchema, emptyProfileQuests } from "./profile-quests";
import { dailySurveySchema, latestSurveyPressure, validDailySurvey } from "./daily-survey";
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
  clearDuration,
  travelDuration,
} from "./battle";
import { stagePolicies, wavePolicies } from "./game-policy";
import { questRewards, allQuestsGoldBonus } from "./quest-policy";
import {
  dailyCombatExperienceLimit,
  experienceProgress,
  levelUpGold,
  questExperience,
} from "./experience";
import { effectCatalog, rpAllowance, rpPolicy } from "./economy";
import type { EffectId } from "./economy";

export const stepSnapshotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().nonnegative(),
  source: z.enum(["health-connect", "healthkit"]),
  syncedAt: z.number().finite().nonnegative(),
});
export type StepSnapshot = z.infer<typeof stepSnapshotSchema>;

export const questIds = ["medicine", "meal", "walk", "water", "sleep", "survey"] as const;
export const mainQuestIds = ["medicine", "meal", "walk", "survey"] as const;
export const mainQuestCount = (completed: readonly string[]) =>
  mainQuestIds.filter((id) => completed.includes(id)).length;
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
    title: "약 / 영양제 복용",
    shortTitle: "약 / 영양제",
    progress: 1,
    progressLabel: "오전 8:00 · 완료",
    experience: questRewards.medicine.experience,
    reason: "등록한 약이나 영양제의 복용 시간을 잊지 않도록 기록하는 체크예요.",
  },
  {
    id: "meal",
    title: "건강한 식사하기",
    shortTitle: "건강한 식사",
    progress: 1,
    progressLabel: "오전 8:30 · 완료",
    experience: questRewards.meal.experience,
    reason: "오늘의 식사 습관을 확인하고 꾸준히 기록해요.",
  },
  {
    id: "walk",
    title: "6,000걸음 걷기",
    shortTitle: "6,000걸음",
    progress: 0.54,
    progressLabel: "3,240 / 6,000걸음",
    experience: questRewards.walk.experience,
    reason: "나에게 맞는 걷기 습관을 기록해요. 건강 앱의 오늘 걸음 수로 목표 달성을 확인해요.",
  },
  {
    id: "water",
    title: "물 마시기 실천",
    shortTitle: "물 마시기",
    progress: 0,
    progressLabel: "동작 인증 대기",
    experience: questRewards.water.experience,
    reason: "오늘의 물 마시기 실천을 기록해요. 개인별 안내에 맞춰 실천해 주세요.",
  },
  {
    id: "sleep",
    title: "수면 7시간 달성",
    shortTitle: "수면",
    progress: 370 / 420,
    progressLabel: "6시간 10분",
    experience: questRewards.sleep.experience,
    reason: "어젯밤의 수면을 돌아보고 일정한 수면 습관을 기록해요.",
  },
  {
    id: "survey",
    title: "오늘의 건강 서베이",
    shortTitle: "건강 서베이",
    progress: 0,
    progressLabel: "오늘의 기록 대기",
    experience: questRewards.survey.experience,
    reason: "매일의 혈압·맥박·수면과 생활 기록을 남겨 대시보드 분석에 활용해요.",
  },
];

export const mainQuests = [
  quests.find((q) => q.id === "survey")!,
  ...quests.filter((q) => q.id !== "survey" && mainQuestIds.some((id) => id === q.id)),
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
    waveAutoRestart: z.boolean().default(true),
    showBattleDamage: z.boolean().default(true),
    showMonsterHealth: z.boolean().default(true),
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
    questHistory: z.record(z.string(), z.number().int().min(0).max(5)).default({}),
    battleDefeats: z.number().int().nonnegative().default(0),
    combatExperienceToday: z.number().int().nonnegative().default(0),
    questHistoryDetails: z.record(z.string(), z.array(z.enum(questIds))).default({}),
    profileQuests: profileQuestSchema.default(emptyProfileQuests),
    dailySurveys: z.record(z.string(), dailySurveySchema).default({}),
    sleepExperience: z
      .record(
        z.string(),
        z.object({
          base: z.number().int().nonnegative(),
          experience: z.number().int().nonnegative(),
          baseline: z.number().int().nonnegative(),
        }),
      )
      .default({}),
    healthHistory: z
      .record(
        z.string(),
        z.object({
          steps: z.number().nonnegative().nullable(),
          sleepHours: z.number().min(0).max(24).nullable(),
          systolic: z.number().nullable().optional(),
          diastolic: z.number().nullable().optional(),
          restingHr: z.number().nullable().optional(),
          glucose: z.number().nullable().optional(),
        }),
      )
      .default({}),
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
  debugBuffs?: import("./battle").DebugBuffs;
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
    waveAutoRestart: true,
    showBattleDamage: true,
    showMonsterHealth: true,
    ownedEffects: ["original"],
    battleEffect: "original",
    ownedAccessories: [],
    equippedAccessories: { head: null, pet: null },
    bonusClaimed: false,
    allDoneBonusClaimed: false,
    sampleDay: false,
    steps: null,
    completedDates: [],
    questHistory: {},
    battleDefeats: 0,
    combatExperienceToday: 0,
    questHistoryDetails: {},
    profileQuests: emptyProfileQuests(),
    dailySurveys: {},
    sleepExperience: {},
    healthHistory: {},
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
    questHistory: {
      ...state.questHistory,
      [state.date]: state.sampleDay
        ? 0
        : state.allDoneBonusClaimed
          ? mainQuestCount(state.completed) === mainQuestIds.length
            ? mainQuestIds.length
            : 5
          : mainQuestCount(state.completed),
    },
    questHistoryDetails: {
      ...state.questHistoryDetails,
      [state.date]: state.sampleDay ? [] : state.completed,
    },
    healthHistory: {
      ...state.healthHistory,
      [state.date]: {
        ...state.healthHistory[state.date],
        steps: state.steps?.count ?? null,
        sleepHours: state.sleepHours,
      },
    },
    combatExperienceToday: 0,
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
  if (id === "sleep" || current.completed.includes(id)) return current;
  if (id === "survey" && !validDailySurvey(current.dailySurveys[date], date, now)) return current;
  if (id === "walk" && (!current.steps || current.steps.count < 6000)) return current;
  if (id === "water" && current.lastWaterAt !== null && now - current.lastWaterAt < 7_200_000)
    return current;
  const quest = quests.find((item) => item.id === id);
  if (!quest) throw new Error("존재하지 않는 퀘스트입니다.");
  const completed = [...current.completed, id];
  const allDone = mainQuestCount(completed) === mainQuestIds.length;
  const gained = questExperience(quest.experience, current.experience);
  const experience = current.experience + gained;
  const gold =
    levelUpGold(current.experience, experience) +
    questRewards[id].gold +
    (allDone && !current.allDoneBonusClaimed ? allQuestsGoldBonus : 0);
  return {
    ...current,
    completed,
    questHistory: { ...current.questHistory, [date]: mainQuestCount(completed) },
    questHistoryDetails: { ...current.questHistoryDetails, [date]: completed },
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

export function recordDailySurvey(
  state: GameState,
  value: unknown,
  date = localDate(),
  now = Date.now(),
): GameState {
  const survey = validDailySurvey(value, date, now);
  if (!survey) return state;
  const current = rollDay(state, date);
  const pressure = latestSurveyPressure(survey);
  const next = {
    ...current,
    sampleDay: false,
    sleepHours: survey.sleepHours,
    dailySurveys: { ...current.dailySurveys, [date]: survey },
    healthHistory: {
      ...current.healthHistory,
      [date]: {
        ...current.healthHistory[date],
        steps:
          current.steps?.date === date
            ? current.steps.count
            : (current.healthHistory[date]?.steps ?? null),
        sleepHours: survey.sleepHours,
        systolic: pressure?.systolic ?? null,
        diastolic: pressure?.diastolic ?? null,
        restingHr: survey.restingHr,
        glucose: survey.fastingGlucose,
      },
    },
  };
  return awardSleepExperience(completeQuest(next, "survey", date, now), survey.sleepHours, date);
}

// Game reward only: 20 base EXP per recorded hour, capped at 8 hours (160).
// Corrections can only increase the day's highest earned amount; they cannot reset it.
export function awardSleepExperience(
  state: GameState,
  hours: number | null,
  date = state.date,
): GameState {
  if (date !== state.date || hours === null || !Number.isFinite(hours) || hours < 0 || hours > 24)
    return state;
  const base = Math.min(160, Math.floor(hours * 20));
  const prior = state.sleepExperience[date];
  if (!prior && state.completed.includes("sleep")) return state; // Preserve already earned legacy sleep rewards.
  const baseline = prior?.baseline ?? state.experience;
  const target = questExperience(base, baseline);
  const delta = Math.max(0, target - (prior?.experience ?? 0));
  if (!delta) return state;
  const experience = state.experience + delta;
  return {
    ...state,
    experience,
    gold: state.gold + levelUpGold(state.experience, experience),
    sleepExperience: Object.fromEntries(
      Object.entries({ ...state.sleepExperience, [date]: { base, experience: target, baseline } })
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-365),
    ),
  };
}

export function claimDailyBonus(state: GameState, date = localDate()): GameState {
  const current = rollDay(state, date);
  return current.bonusClaimed
    ? current
    : { ...current, gold: current.gold + 10, bonusClaimed: true };
}

export function selectDinosaur(state: GameState, index: number): GameState {
  if (!Number.isInteger(index) || index < 0 || index >= 6 || index === state.dinosaur) return state;
  return {
    ...state,
    dinosaur: index,
    // A pending wind-up must not launch an old character's attack after switching.
    combat: { ...state.combat, playerProjectiles: [], lastAttack: null },
  };
}

export function applyDinosaurStyle(state: GameState, index: number, skin: SkinId): GameState {
  if (!Number.isInteger(index) || index < 0 || index >= 6 || !skinIds.includes(skin)) return state;
  const selected = selectDinosaur(state, index);
  return {
    ...selected,
    dinosaurStyles: selected.dinosaurStyles.map((current, i) => (i === index ? skin : current)),
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
          (total, quest) =>
            total +
            (completed.includes(quest.id)
              ? { medicine: 20, meal: 30, walk: 50, water: 30, sleep: 40, survey: 0 }[quest.id]
              : 0),
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
  const sum = mainQuests.reduce((total, q) => total + questProgress(game, q), 0);
  return Math.floor((sum / mainQuests.length) * 10);
}

export function questProgress(game: GameState, quest: Quest): number {
  if (quest.id === "sleep" && game.sleepHours !== null) return Math.min(1, game.sleepHours / 7);
  if (quest.id === "walk")
    return game.completed.includes("walk") ? 1 : Math.min(1, (game.steps?.count ?? 0) / 6000);
  return game.completed.includes(quest.id)
    ? 1
    : game.sampleDay && quest.progress < 1
      ? quest.progress
      : 0;
}

export function questProgressLabel(game: GameState, quest: Quest): string {
  if (quest.id === "sleep" && !game.completed.includes("sleep") && game.sleepHours !== null)
    return `${Number(game.sleepHours.toFixed(1))}시간 / 7시간`;
  if (quest.id === "walk")
    return `${(game.steps?.count ?? 0).toLocaleString("ko-KR")} / 6,000걸음${game.completed.includes("walk") ? " · 완료" : ""}`;
  if (game.completed.includes(quest.id))
    return game.sampleDay && quest.progress === 1 ? quest.progressLabel : "완료";
  if (game.sampleDay && quest.progress < 1) return quest.progressLabel;
  return {
    survey: "오늘의 기록 대기",
    medicine: "미완료",
    meal: "미완료",
    walk: "0 / 6,000걸음",
    water: "동작 인증 대기",
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

export function weeklyCompletedDays(game: GameState, anchor = game.date): number {
  const week = new Set(calendarWeek(anchor).map((day) => day.date));
  const completed = new Set([
    ...game.completedDates,
    ...Object.keys(game.questHistory).filter(
      (date) =>
        game.questHistory[date] === 5 ||
        (game.questHistoryDetails[date] &&
          mainQuestCount(game.questHistoryDetails[date]) === mainQuestIds.length),
    ),
  ]);
  return Math.min(5, [...completed].filter((date) => week.has(date) && date <= game.date).length);
}

export function questCountOn(game: GameState, date: string): number {
  if (date > game.date) return 0;
  if (date === game.date) return game.sampleDay ? 0 : mainQuestCount(game.completed);
  if (game.completedDates.includes(date)) return mainQuestIds.length;
  return game.questHistoryDetails[date]
    ? mainQuestCount(game.questHistoryDetails[date])
    : Math.min(
        mainQuestIds.length,
        game.questHistory[date] ?? (game.completedDates.includes(date) ? mainQuestIds.length : 0),
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
      current.experience,
      current.waveAutoRestart,
      Math.max(0, dailyCombatExperienceLimit(current.experience) - current.combatExperienceToday),
    );
    current = {
      ...current,
      combat: result.combat,
      gold: current.gold + result.gold,
      experience: current.experience + result.experience,
      combatExperienceToday: current.combatExperienceToday + result.experience,
      battleDefeats: current.battleDefeats + result.defeats,
    };
    cursor = end;
  }
  return { ...rollDay(current, localDate(new Date(now))), battleUpdatedAt: now };
}

export function selectBattleLocation(
  state: GameState,
  stage: number,
  wave: number,
  now = Date.now(),
): GameState {
  if (
    !Number.isInteger(stage) ||
    !Number.isInteger(wave) ||
    stage < 1 ||
    stage > stagePolicies.length ||
    wave < 1 ||
    wave > wavePolicies.length ||
    experienceProgress(state.experience).level < stagePolicies[stage - 1].level ||
    (stage === state.combat.stage && wave === state.combat.wave)
  )
    return state;
  const current = tickBattle(state, now);
  return {
    ...current,
    battleUpdatedAt: now,
    combat: {
      ...initialCombat(battleBuffStats(current).maxHp),
      stage,
      wave,
      clock: current.combat.clock,
      serial: current.combat.serial,
      lastFailure: current.combat.lastFailure,
      seed: current.combat.seed,
      // A manual selection starts at the destination without a false clear reward.
      transition: {
        kind: "wave",
        elapsed: clearDuration("wave") + travelDuration,
        arrived: true,
        fromStage: stage,
        fromWave: wave,
      },
    },
  };
}

export function retryBattle(state: GameState, now = Date.now()): GameState {
  const current = tickBattle(state, now);
  if (current.combat.recovery <= 0) return current;
  const { stage, wave, clock, serial, seed, lastFailure } = current.combat;
  return {
    ...current,
    battleUpdatedAt: now,
    combat: {
      ...initialCombat(battleBuffStats(current).maxHp),
      stage,
      wave,
      clock,
      serial,
      seed,
      lastFailure,
      transition: {
        kind: "wave",
        elapsed: clearDuration("wave") + travelDuration,
        arrived: true,
        fromStage: stage,
        fromWave: wave,
      },
    },
  };
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
    count >= questRewards[id].maxActivities ||
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
