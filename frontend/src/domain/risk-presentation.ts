import { z } from "zod";

// Source priority: docs/toDev decision tree + naming matrix. Reference bands are
// distinct from the Model's provisional probability levels and Ranker priorities.
const bpBands = {
  insufficient: {
    label: "기록 부족 · 판정 보류",
    tone: "neutral",
    description: "최소 5일·12회 이상의 유효 가정혈압 기록을 모아 주세요.",
  },
  normal: {
    label: "정상 참고권",
    tone: "green",
    description: "7일 가정혈압 평균에 대한 참고 밴드예요.",
  },
  elevated: {
    label: "주의 참고권",
    tone: "amber",
    description: "가정혈압 기록과 생활습관을 꾸준히 확인해 주세요.",
  },
  prehtn: {
    label: "전단계 참고권",
    tone: "amber",
    description: "가정혈압 추이를 확인하고 생활습관을 관리해 주세요.",
  },
  htn_suspected: {
    label: "고혈압 의심",
    tone: "red",
    description: "유효한 가정혈압 평균이 높은 상태로 반환됐어요. 진료 시 기록을 보여 주세요.",
  },
} as const;
export const bpResultSchema = z.object({
  bp_band: z.string(),
  crisis_level: z.enum(["none", "recheck", "same_day_visit", "emergency_119"]).nullish(),
  home_sbp_avg_7d: z.number().finite().positive().nullish(),
  home_dbp_avg_7d: z.number().finite().positive().nullish(),
  valid_days_7d: z.number().int().min(0).max(7).nullish(),
  bp_phenotype: z.string().nullish(),
  bp_target: z.enum(["130/80", "140/90"]).nullish(),
  secondary_htn_flags: z.array(z.string()).optional(),
});
export type BpResult = z.infer<typeof bpResultSchema>;
export function bloodPressurePresentation(value: unknown) {
  const parsed = bpResultSchema.safeParse(value);
  if (!parsed.success)
    return {
      label: "판정 결과 대기",
      tone: "neutral",
      description: "측정 기록과 판정 서비스가 연결되면 결과를 보여드려요.",
      result: null,
    };
  const result = parsed.data;
  if (result.crisis_level === "emergency_119")
    return {
      label: "응급 안내",
      tone: "red",
      description: "판정 서비스에서 응급 상태로 반환됐어요. 즉시 119에 연락해 주세요.",
      result,
    };
  if (result.crisis_level === "same_day_visit")
    return {
      label: "당일 진료 안내",
      tone: "red",
      description: "판정 서비스에서 당일 진료가 필요한 상태로 반환됐어요.",
      result,
    };
  if (result.crisis_level === "recheck")
    return {
      label: "재측정 필요",
      tone: "amber",
      description: "5분 안정 후 다시 측정해 주세요.",
      result,
    };
  const code = result.bp_band.replace(/_ref$/, "");
  const band =
    typeof result.valid_days_7d === "number" && result.valid_days_7d < 5
      ? bpBands.insufficient
      : bpBands[code as keyof typeof bpBands];
  return {
    ...(band ?? {
      label: "알 수 없는 판정 코드",
      tone: "neutral",
      description: "지원하는 결과 코드가 도착할 때까지 등급을 표시하지 않아요.",
    }),
    result,
  };
}
export const modelResultSchema = z.object({
  risk_index: z.number().min(0).max(100).nullable(),
  calibrated_p: z.number().min(0).max(1).nullable(),
  risk_level: z.enum(["low", "moderate", "high", "very_high"]).nullable(),
  model_id: z.string().nullable(),
  model_version: z.string(),
  data_quality: z.string(),
});
export type ModelResult = z.infer<typeof modelResultSchema>;
export function modelPresentation(value: unknown) {
  const parsed = modelResultSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.calibrated_p === null ||
    parsed.data.risk_index === null ||
    parsed.data.risk_level === null ||
    parsed.data.model_id === null
  )
    return {
      label: "모델 결과 대기",
      value: null,
      description: "서비스 연결 전 · 참고 지표가 아직 없어요.",
    };
  const labels = { low: "낮음", moderate: "중간", high: "높음", very_high: "매우 높음" };
  return {
    label: `${labels[parsed.data.risk_level]} · 모델 참고`,
    value: parsed.data.risk_index,
    description: `모델 ${parsed.data.model_version} · 혈압 판정 밴드와 별개의 참고 지표예요.`,
  };
}
export const rankerResultSchema = z
  .array(
    z.object({ quest_id: z.string(), priority: z.number().int().positive(), reason: z.string() }),
  )
  .max(20);
export function rankerPresentation(value: unknown) {
  const parsed = rankerResultSchema.safeParse(value);
  return parsed.success ? [...parsed.data].sort((a, b) => a.priority - b.priority) : [];
}
