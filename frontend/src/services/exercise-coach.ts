import { cloudEnabled, supabase } from "../cloud/client";
import config from "../../diet.config.json";
import {
  coachPlanSchema,
  coachContextKey,
  eligibleExercises,
  type CoachContext,
  type CoachSurvey,
} from "../domain/exercise-coach";

export async function requestExercisePlan(
  date: string,
  survey: CoachSurvey,
  context: CoachContext,
  owner: string | null,
  signal: AbortSignal,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cloudEnabled) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session || session.user.id !== owner)
      throw new Error("계정이 변경됐어요. 다시 로그인해 주세요.");
    headers.Authorization = `Bearer ${session.access_token}`;
  } else if (!import.meta.env.DEV)
    throw new Error("AI 추천은 로그인 후 사용할 수 있어요. 기본 추천을 이용해 주세요.");
  if (import.meta.env.DEV) headers["X-REXRUN-Development"] = "1";
  const base =
    import.meta.env.VITE_REXRUN_DIET_API_URL || (import.meta.env.DEV ? "/api/diet" : config.apiUrl);
  const response = await fetch(`${base}/exercise/recommend`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({ date, survey, context, ai_consent: true }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.detail?.message ?? "AI 추천 연결을 확인해 주세요. 기본 추천을 이용할 수 있어요.",
    );
  const plan = coachPlanSchema.parse({
    ...data,
    contextKey: coachContextKey(context),
    surveyRevision: survey.updatedAt,
  });
  const safe = eligibleExercises(survey, context).items;
  if (
    plan.date !== date ||
    new Set(plan.items.map((i) => i.id)).size !== plan.items.length ||
    plan.items.some((item) => !safe.some((s) => s.id === item.id))
  )
    throw new Error("추천 결과를 확인하지 못했어요. 기본 추천을 이용해 주세요.");
  return plan;
}
