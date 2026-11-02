import { useQuestAnalysis } from "../services/useQuestAnalysis";
import { bpStageLabels } from "../domain/bp-stage";
import { analysisSourceLabel, m2StateLabels } from "../domain/quest-analysis";
import { QuestModelSummary } from "./QuestModelSummary";
import { DemoInputChangedError } from "../domain/demo-analysis-input";
export function DashboardPredictionBrief() {
  const query = useQuestAnalysis(),
    analysis = query.data;
  const states = analysis ? Object.entries(analysis.m2.states) : [];
  const confirmed = states.filter(([, state]) => state.status === "positive");
  const pending = states.filter(([, state]) =>
    ["not_evaluable", "not_evaluated"].includes(state.status),
  ).length;
  const valid =
    analysis &&
    analysis.m1.data_quality !== "out_of_range" &&
    !["invalid", "out_of_range"].includes(analysis.m2.data_quality);
  const headline = !analysis
    ? query.isError
      ? query.error instanceof DemoInputChangedError
        ? "입력 변경됨 · 시연 초기화로 복원"
        : "분석 연결을 확인해 주세요"
      : query.ready
        ? "모델 결과를 확인하고 있어요"
        : "기록 동의 후 분석할 수 있어요"
    : !valid
      ? "입력값 확인 후 분석할 수 있어요"
      : analysis.m1.stage_top
        ? `${bpStageLabels[analysis.m1.stage_top]} · 확인 ${confirmed.length}항목`
        : confirmed.length
          ? confirmed.length === 1
            ? `${m2StateLabels[confirmed[0][0]] ?? "기록 확인"} 1항목`
            : `추가 확인 ${confirmed.length}항목 · ${m2StateLabels[confirmed[0][0]] ?? "기록 확인"} 등`
          : pending
            ? `추가 자료가 필요한 ${pending}항목 확인`
            : "현재 모델에서 추가 확인 항목 없음";
  return (
    <section className="dashboard-prediction" aria-label="최종 분석 요약">
      <div className="prediction-meta">
        <span>최종 분석 요약</span>
        <small>{analysis ? `최신 입력 ${analysis.as_of}` : "M1 · M2"}</small>
      </div>
      <p className="prediction-sentence" role="status">
        {headline}
      </p>
      {analysis && (
        <div className="prediction-foot">
          <span>{analysisSourceLabel(analysis)}</span>
          <span>평가 대기 {pending}항목</span>
        </div>
      )}
      <details>
        <summary>모델 근거와 해석 보기</summary>
        <QuestModelSummary />
      </details>
      {!analysis && query.isError && (
        <button type="button" onClick={() => void query.refetch()}>
          분석 다시 확인
        </button>
      )}
    </section>
  );
}
