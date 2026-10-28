import { z } from "zod";
import { bpStageSchema } from "./bp-stage";
import { questIds, type QuestId } from "./game";
export const m2StatusLabels = {
  positive: "확인 항목",
  negative: "해당 없음",
  not_evaluable: "자료 대기",
  not_applicable: "대상 제외",
  not_evaluated: "평가 보류",
};
export const m2StateLabels: Record<string, string> = {
  ELEVATED: "높아진 혈압 단계",
  PREHTN: "전단계 참고",
  HTN_SUSPECT: "높은 혈압 확인",
  HTN_STAGE2_SCREEN: "높은 단계 선별",
  ISH: "수축기 관련 확인",
  WHITE_COAT: "진료실·가정 비교",
  MASKED: "가정·진료실 비교",
  MORNING: "아침·저녁 비교",
  NOCTURNAL_SCREEN: "수면 관련 확인",
  RESISTANT_SUSPECT: "치료 중 혈압 확인",
};
export const questAnalysisSchema = z.object({
  m1: bpStageSchema,
  m1_bridge: z.object({
    step: z.enum(["normal", "elevated", "prehtn", "htn"]).nullable(),
    source: z.string(),
  }),
  m2: z.object({
    module: z.literal("M2"),
    contract_version: z.string(),
    data_quality: z.string(),
    states: z.record(
      z.string(),
      z.object({
        status: z.enum([
          "positive",
          "negative",
          "not_evaluable",
          "not_applicable",
          "not_evaluated",
        ]),
        missing_required: z.array(z.string()),
        notes: z.array(z.string()),
      }),
    ),
  }),
  previous_day: z.object({
    date: z.string(),
    completed_quests: z.array(z.enum(questIds)).nullable(),
    steps: z.number().nullable(),
    sleep_hours: z.number().nullable(),
  }),
  source: z.enum(["synthetic-demo", "saved-profile"]),
  as_of: z.string(),
  daily_survey_date: z.string().nullable().optional(),
});
export type QuestAnalysis = z.infer<typeof questAnalysisSchema>;
export type RankedQuest = {
  quest: QuestId;
  priority: number;
  reason: string;
  modelCodes: string[];
};

// Transparent prioritization of the existing goals. No treatment or dose changes.
export function rankSubQuests(analysis: QuestAnalysis, hasMedication: boolean): RankedQuest[] {
  if (["invalid", "out_of_range"].includes(analysis.m2.data_quality)) return [];
  const previous = analysis.previous_day;
  const positives = Object.entries(analysis.m2.states)
    .filter(([, s]) => s.status === "positive")
    .map(([id]) => id);
  const candidates: RankedQuest[] = [];
  if (hasMedication && previous.completed_quests && !previous.completed_quests.includes("medicine"))
    candidates.push({
      quest: "medicine",
      priority: 100,
      reason: "어제 약 / 영양제 복용 퀘스트가 완료되지 않았어요. 오늘 등록된 일정을 확인해요.",
      modelCodes: [],
    });
  if (previous.sleep_hours !== null && previous.sleep_hours < 7)
    candidates.push({
      quest: "survey",
      priority: positives.includes("NOCTURNAL_SCREEN") ? 95 : 80,
      reason: `어제 수면 ${previous.sleep_hours}시간을 기록했어요. 오늘의 건강 서베이에서 수면 기록을 돌아봐요.`,
      modelCodes: positives.filter((c) => c === "NOCTURNAL_SCREEN"),
    });
  if (previous.steps !== null && previous.steps < 6000)
    candidates.push({
      quest: "walk",
      priority: 70,
      reason: `어제 ${previous.steps.toLocaleString("ko-KR")}보를 기록했어요. 나에게 맞는 오늘의 걷기 목표를 확인해요.`,
      modelCodes: [],
    });
  if (previous.completed_quests && !previous.completed_quests.includes("meal"))
    candidates.push({
      quest: "meal",
      priority: 60,
      reason: "어제 식사 기록이 없어요. 오늘의 식사 사진을 기록해요.",
      modelCodes: positives.filter((c) => c === "PREHTN"),
    });
  if (previous.completed_quests && !previous.completed_quests.includes("water"))
    candidates.push({
      quest: "water",
      priority: 50,
      reason: "어제 물 마시기 실천 기록이 없어요. 개인별 안내에 맞춰 실천하고 기록해요.",
      modelCodes: [],
    });
  return candidates.sort((a, b) => b.priority - a.priority).slice(0, 3);
}
