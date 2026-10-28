import { z } from "zod";
import type { HealthProfile } from "./profile";
import type { Medication } from "./medications";

export const bpStages = ["normal", "elevated", "prehtn", "htn"] as const;
export const bpStageLabels = {
  normal: "정상 참고권",
  elevated: "주의 참고권",
  prehtn: "전단계 참고권",
  htn: "높은 혈압 단계 참고권",
};
const reasons = {
  bmi_high: "체질량지수",
  waist_high: "허리둘레",
  age: "연령",
  alcohol_high: "음주 습관",
  activity_low: "활동 시간",
  sleep_short: "짧은 수면",
  family_htn: "고혈압 가족력",
  diabetes: "당뇨 관련 입력",
};
export const bpStageInputLabels = {
  age: "나이",
  sex: "성별",
  bmi: "키·몸무게",
  waist_cm: "허리둘레",
  alcohol_week: "주당 표준잔 수",
  activity_minutes_week: "주당 활동 시간",
  family_htn: "고혈압 가족력",
  sleep_hours: "하루 수면 시간",
  diabetes_flag: "지병·기저질환 여부",
  fasting_glucose: "공복 혈당",
  resting_hr: "안정 시 맥박",
  education_years: "교육 이수 연수",
};
export const bpStageSchema = z
  .object({
    stage_probs: z
      .object({
        normal: z.number().min(0).max(1),
        elevated: z.number().min(0).max(1),
        prehtn: z.number().min(0).max(1),
        htn: z.number().min(0).max(1),
      })
      .nullable(),
    stage_top: z.enum(bpStages).nullable(),
    risk_level: z.enum(bpStages).nullable(),
    reason_codes: z.array(
      z.enum(Object.keys(reasons) as [keyof typeof reasons, ...Array<keyof typeof reasons>]),
    ),
    data_quality: z.enum(["ok", "partial", "insufficient", "out_of_range", "not_applicable"]),
    model_version: z.string().min(1),
    feature_version: z.string().min(1),
    problems: z.string().optional(),
    missing_inputs: z
      .array(
        z.enum(
          Object.keys(bpStageInputLabels) as [
            keyof typeof bpStageInputLabels,
            ...Array<keyof typeof bpStageInputLabels>,
          ],
        ),
      )
      .optional(),
  })
  .superRefine((v, ctx) => {
    const usable = v.data_quality === "ok" || v.data_quality === "partial";
    if (
      usable !== Boolean(v.stage_probs && v.stage_top && v.risk_level) ||
      v.stage_top !== v.risk_level ||
      (v.stage_probs &&
        Math.abs(Object.values(v.stage_probs).reduce((a, b) => a + b, 0) - 1) > 0.0003) ||
      (!usable && (v.stage_probs !== null || v.stage_top !== null || v.risk_level !== null))
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid M1-S stage result" });
    }
  });
export type BpStageResult = z.infer<typeof bpStageSchema>;

// This identifies the acknowledged health snapshot only; game ticks do not
// trigger inference. It stays in memory and is scoped to the signed-in account.
export function healthSnapshotKey(
  profile?: HealthProfile,
  medications: Medication[] = [],
  game?: { date: string; dailySurveys?: Record<string, unknown> },
) {
  if (!profile) return null;
  const {
    age,
    sex,
    height,
    weight,
    bloodPressure,
    glucose,
    conditions,
    htnStatus,
    alcoholDays,
    activeMinutesWeek,
    sleepHours,
    hypertensionFamily,
    familyHistory,
  } = profile;
  const previous = game ? new Date(game.date + "T12:00:00") : null;
  previous?.setDate(previous.getDate() - 1);
  const before = previous
    ? `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}-${String(previous.getDate()).padStart(2, "0")}`
    : "";
  const currentSurvey = game?.dailySurveys?.[game.date] ?? null;
  const previousSurvey = game?.dailySurveys?.[before] ?? null;
  const daily =
    currentSurvey || previousSurvey ? [{ date: game?.date, currentSurvey, previousSurvey }] : [];
  return JSON.stringify([
    {
      age,
      sex,
      height,
      weight,
      bloodPressure,
      glucose,
      diabetes:
        !conditions.length &&
        (profile.conditionStatus === "unknown" || profile.conditionStatus === "selected")
          ? null
          : conditions.includes("diabetes"),
      htnStatus,
      alcoholDays,
      activeMinutesWeek,
      sleepHours,
      hypertensionFamily,
      familyHtn: familyHistory.includes("hypertension"),
      waistCm: profile.waistCm ?? null,
      restingHeartRate: profile.restingHeartRate ?? null,
      educationYears: profile.educationYears ?? null,
      alcoholWeek: alcoholDays === 0 ? 0 : (profile.alcoholWeek ?? null),
      bingeMonthly: alcoholDays === 0 ? false : (profile.bingeMonthly ?? null),
    },
    medications.filter((m) => m.active && ["hypertension", "고혈압"].includes(m.condition)).length >
      0,
    ...daily,
  ]);
}

export function bpStagePresentation(result: BpStageResult) {
  const label = result.stage_top
    ? bpStageLabels[result.stage_top]
    : {
        insufficient: "추가 입력이 필요해요",
        out_of_range: "입력값을 확인해 주세요",
        not_applicable: "혈압 기록을 기준으로 확인해요",
        ok: "결과 확인 중",
        partial: "결과 확인 중",
      }[result.data_quality];
  const description =
    result.data_quality === "not_applicable"
      ? "혈압을 입력했거나 혈압약을 복용 중이면 생활습관으로 혈압 단계를 추정하지 않아요."
      : result.data_quality === "insufficient"
        ? "분석에 필요한 입력 항목이 부족해요. ‘없음’과 0은 정상 응답이며, 모르는 값은 임의로 채우지 않아요."
        : result.data_quality === "out_of_range"
          ? "이 모델은 만 19~90세, BMI 14~50, 주당 활동 2,000분 이내 입력을 사용해요."
          : result.data_quality === "partial"
            ? "일부 정보가 없어 모델의 결측 처리를 적용한 참고 결과예요."
            : "생활습관·신체 정보로 추정한 참고 결과이며 진단이나 미래 발병 확률이 아니에요.";
  return { label, description, reasons: result.reason_codes.map((code) => reasons[code]) };
}
