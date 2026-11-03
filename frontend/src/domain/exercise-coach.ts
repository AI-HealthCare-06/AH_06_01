import { z } from "zod";
import type { GameState } from "./game";
import type { HealthProfile } from "./profile";

export const exerciseIds = [
  "desk-release",
  "ankle-pump",
  "walk-break",
  "ott-walk",
  "easy-dance",
  "long-walk",
] as const;
export const exerciseCatalog = [
  {
    id: "desk-release",
    title: "화면 쉬는 시간 · 어깨 풀기",
    minutes: 2,
    kind: "stretch",
    blocked: ["shoulder"],
    steps: [
      "편하게 앉아 어깨의 힘을 빼요.",
      "숨을 참지 않고 어깨를 천천히 올렸다 내려요.",
      "통증 없는 범위에서 양팔을 가볍게 뻗어요.",
    ],
  },
  {
    id: "ankle-pump",
    title: "앉아서 발목 움직이기",
    minutes: 2,
    kind: "stretch",
    blocked: [],
    steps: [
      "안정된 의자에 앉아 발을 바닥에 둬요.",
      "발뒤꿈치와 발끝을 번갈아 천천히 들어요.",
      "편하게 호흡하며 무리하지 않고 반복해요.",
    ],
  },
  {
    id: "walk-break",
    title: "점심 후 가볍게 걷기",
    minutes: 5,
    kind: "walk",
    blocked: ["knee"],
    steps: [
      "평평하고 안전한 곳에서 천천히 걸어요.",
      "대화할 수 있는 편한 속도를 유지해요.",
      "마지막에는 속도를 줄이며 마쳐요.",
    ],
  },
  {
    id: "ott-walk",
    title: "드라마 시작 전 · 제자리 걷기",
    minutes: 5,
    kind: "walk",
    blocked: ["knee"],
    steps: [
      "화면 주변의 장애물을 치워요.",
      "드라마를 시작하기 전 제자리에서 천천히 걸어요.",
      "숨을 참지 않고 편안한 속도로 마쳐요.",
    ],
  },
  {
    id: "easy-dance",
    title: "좋아하는 음악 · 가볍게 움직이기",
    minutes: 5,
    kind: "move",
    blocked: ["knee", "back"],
    steps: [
      "미끄럽지 않은 바닥에서 시작해요.",
      "점프 없이 음악에 맞춰 발을 천천히 옮겨요.",
      "편안하게 호흡하고 힘들면 쉬어요.",
    ],
  },
  {
    id: "long-walk",
    title: "바깥 공기 · 편안한 산책",
    minutes: 10,
    kind: "walk",
    blocked: ["knee"],
    steps: [
      "평평한 길과 편한 신발을 골라요.",
      "대화 가능한 속도로 천천히 걸어요.",
      "마지막 몇 분은 더 천천히 걸으며 마쳐요.",
    ],
  },
] as const;
export const coachSurveySchema = z.object({
  motivation: z.enum(["fun", "routine", "social"]),
  context: z.enum(["ott", "desk", "outdoors"]),
  minutes: z.union([z.literal(2), z.literal(5), z.literal(10), z.literal(15)]),
  activity: z.enum(["inactive", "occasional", "regular"]),
  period: z.enum(["morning", "lunch", "evening"]),
  limits: z.array(z.enum(["knee", "back", "shoulder", "doctor", "pregnancy"])).max(5),
  clinicianCleared: z.boolean(),
  alcoholDays: z.number().int().min(0).max(7),
  binge: z.boolean(),
  updatedAt: z.number().finite().nonnegative(),
});
export type CoachSurvey = z.infer<typeof coachSurveySchema>;
export const coachPlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  surveyRevision: z.number(),
  contextKey: z.string().max(200),
  source: z.enum(["ai", "rules"]),
  model: z.string().max(120).nullable(),
  summary: z.string().min(1).max(240),
  items: z.array(z.object({ id: z.enum(exerciseIds), reason: z.string().min(1).max(180) })).max(3),
});
export type CoachPlan = z.infer<typeof coachPlanSchema>;
export const coachStateSchema = z.object({
  survey: coachSurveySchema.nullable().catch(null),
  plan: coachPlanSchema.nullable().catch(null),
  completed: z.record(z.string(), z.array(z.enum(exerciseIds)).max(6)),
});
export const emptyCoach = () => ({ survey: null, plan: null, completed: {} });
export type CoachContext = {
  age: number;
  hypertension: boolean;
  pressure: { systolic: number; diastolic: number } | null;
  pressureDate: string | null;
  pregnancy: boolean;
  recentCompleted: number;
};
export function coachContext(game: GameState, profile: HealthProfile): CoachContext {
  const survey = game.dailySurveys[game.date];
  return {
    age: profile.age,
    hypertension:
      profile.conditions.includes("hypertension") ||
      ["on_medication", "diagnosed_untreated"].includes(profile.htnStatus),
    pressure:
      survey?.bloodPressureStatus === "measured" ? (survey.evening ?? survey.morning) : null,
    pressureDate: survey?.bloodPressureStatus === "measured" ? game.date : null,
    pregnancy: ["pregnant", "postpartum_6w"].includes(profile.pregnancyStatus),
    recentCompleted: Object.entries(game.exerciseCoach.completed)
      .filter(
        ([date]) =>
          date < game.date &&
          date >=
            new Date(Date.parse(game.date + "T00:00:00Z") - 7 * 86400000)
              .toISOString()
              .slice(0, 10),
      )
      .reduce((n, [, ids]) => n + ids.length, 0),
  };
}
export const coachContextKey = (context: CoachContext) => JSON.stringify(context);
export function eligibleExercises(survey: CoachSurvey, context: CoachContext) {
  if (
    context.age < 18 ||
    context.pregnancy ||
    survey.limits.includes("doctor") ||
    survey.limits.includes("pregnancy")
  )
    return { message: "개인별 운동 범위를 의료진과 먼저 확인해 주세요.", items: [] };
  if (context.pressure && (context.pressure.systolic >= 180 || context.pressure.diastolic >= 120))
    return {
      message:
        "운동을 시작하지 말고 혈압을 다시 확인한 뒤 의료진에게 문의해 주세요. 흉통·호흡곤란·마비 등 증상이 있으면 즉시 응급 도움을 요청하세요.",
      items: [],
    };
  if (context.hypertension && !survey.clinicianCleared)
    return {
      message:
        "고혈압 진단 이력이 있어요. 운동 가능한 범위를 의료진과 확인한 뒤 설문을 수정해 주세요.",
      items: [],
    };
  const gentleOnly =
    !context.pressure || context.pressure.systolic >= 160 || context.pressure.diastolic >= 100;
  const cap =
    survey.activity === "inactive" || context.recentCompleted < 4
      ? Math.min(survey.minutes, 5)
      : survey.minutes;
  return {
    message: gentleOnly
      ? "오늘 혈압을 먼저 확인해 주세요. 현재는 앉아서 하는 가벼운 움직임만 제안해요."
      : "통증·어지럼·가슴 불편감이 있거나 음주 직후라면 시작하지 말고 쉬어요.",
    items: exerciseCatalog.filter(
      (item) =>
        item.minutes <= cap &&
        (!gentleOnly || item.kind === "stretch") &&
        !item.blocked.some((limit) => survey.limits.includes(limit)),
    ),
  };
}
export function ruleCoachPlan(date: string, survey: CoachSurvey, context: CoachContext): CoachPlan {
  const safe = eligibleExercises(survey, context);
  const items = [...safe.items]
    .sort((a, b) => {
      const score = (id: string) =>
        id ===
        (survey.context === "ott"
          ? "ott-walk"
          : survey.context === "desk"
            ? "desk-release"
            : "long-walk")
          ? 3
          : id === "desk-release"
            ? 2
            : 1;
      return score(b.id) - score(a.id);
    })
    .slice(0, 3);
  return {
    date,
    surveyRevision: survey.updatedAt,
    contextKey: coachContextKey(context),
    source: "rules",
    model: null,
    summary: safe.message,
    items: items.map((item) => ({
      id: item.id,
      reason: `${survey.context === "ott" ? "드라마를 보기 전" : survey.context === "desk" ? "업무 중 쉬는 시간에" : "일상에서"} ${item.minutes}분부터 시작해요. ${survey.motivation === "fun" ? "짧게 완료하고 성장 보상을 받아요." : "부담 없는 실천을 꾸준히 쌓아요."}`,
    })),
  };
}
