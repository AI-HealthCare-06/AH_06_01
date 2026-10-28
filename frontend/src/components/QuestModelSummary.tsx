import { useQuestAnalysis } from "../services/useQuestAnalysis";
import { m2StateLabels, m2StatusLabels } from "../domain/quest-analysis";
import { bpStagePresentation } from "../domain/bp-stage";
export function QuestModelSummary() {
  const query = useQuestAnalysis();
  const analysis = query.data;
  if (!analysis)
    return (
      <section className="quest-model-summary cream-card" aria-label="M1·M2 참고 분석">
        <header>
          <h3>M1 · M2 참고 분석</h3>
        </header>
        <p role="status">
          {!query.ready
            ? "건강 정보 저장 동의 후 분석하거나 데모를 체험해 보세요."
            : query.isError
              ? "분석에 연결하지 못했어요."
              : "모델 응답을 확인하고 있어요…"}
        </p>
        {query.ready && query.isError && (
          <button type="button" onClick={() => void query.refetch()}>
            분석 다시 불러오기
          </button>
        )}
      </section>
    );
  const presentation = bpStagePresentation(analysis.m1);
  const states = Object.entries(analysis.m2.states);
  const counts = Object.fromEntries(
    Object.keys(m2StatusLabels).map((status) => [
      status,
      states.filter(([, s]) => s.status === status).length,
    ]),
  );
  return (
    <section className="quest-model-summary cream-card" aria-label="M1·M2 참고 분석">
      <header className="stitch-section-heading">
        <h3>M1 · M2 참고 분석</h3>
        <span className="pixel-tag">
          {analysis.source === "synthetic-demo" ? "합성 입력 · 실제 호출" : "모델 응답"}
        </span>
      </header>
      <p className="analysis-as-of">
        기준 {analysis.as_of} · 전날 기록 {analysis.previous_day.date}
        {analysis.daily_survey_date && (
          <span> · 일일 서베이 {analysis.daily_survey_date} 반영</span>
        )}
      </p>
      <div className="model-pipeline">
        <div>
          <small>M1-S</small>
          <strong>{presentation.label}</strong>
          <p>{presentation.description}</p>
        </div>
        <span aria-hidden="true">↓</span>
        <div>
          <small>M2 · 기록 확인</small>
          <strong>
            확인 항목 {counts.positive} / {states.length}
          </strong>
          <p>
            {analysis.m1_bridge.source === "medication-contract"
              ? "혈압약 복용 기록을 기준으로 확인해요. 혈압 추정 확률로 바꾸지 않아요."
              : analysis.m1_bridge.source === "unavailable"
                ? "평가 가능한 M1 단계가 없어 추가 자료를 기다려요."
                : "M1 응답의 단계를 전달했어요."}
          </p>
        </div>
      </div>
      {analysis.m1.stage_probs && (
        <div className="analysis-probabilities" aria-label="M1 단계별 참고 분포">
          {Object.entries(analysis.m1.stage_probs).map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <progress max={1} value={value} />
              <b>{(value * 100).toFixed(1)}%</b>
            </div>
          ))}
        </div>
      )}
      <div
        className="m2-status-mix"
        role="img"
        aria-label={Object.entries(counts)
          .map(
            ([status, n]) => m2StatusLabels[status as keyof typeof m2StatusLabels] + " " + n + "개",
          )
          .join(", ")}
      >
        {Object.entries(counts).map(
          ([status, n]) => n > 0 && <i key={status} data-status={status} style={{ flex: n }} />,
        )}
      </div>
      <dl className="m2-state-grid">
        {states.map(([code, state]) => (
          <div key={code} data-status={state.status}>
            <dt>{m2StateLabels[code] ?? code}</dt>
            <dd>{m2StatusLabels[state.status]}</dd>
          </div>
        ))}
      </dl>
      <small className="analysis-note">
        자료 대기·대상 제외는 정상 판정이 아니에요. M1·M2는 참고 응답이며 진단이나 약 조절 안내가
        아니에요.
      </small>
    </section>
  );
}
