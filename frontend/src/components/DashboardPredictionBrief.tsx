import { Link, useLocation } from "react-router-dom";
import { useQuestAnalysis } from "../services/useQuestAnalysis";
import { bpStagePresentation } from "../domain/bp-stage";
import {
  dashboardPressure,
  approvedLifestyleResult,
  pressureChange,
} from "../domain/dashboard-pressure";
import { demoMode } from "../domain/demo-mode";
import { useGameStore } from "../stores/game-store";
import { useProfileStore } from "../stores/profile-store";
import { healthPeriods, type HealthPeriod } from "../services/health-history";
import type { QuestAnalysis } from "../domain/quest-analysis";

function RecordLink() {
  const location = useLocation();
  return (
    <Link
      className="pressure-record-link"
      to="/daily-survey"
      state={{ surveyBackground: location }}
    >
      혈압 기록하기 ›
    </Link>
  );
}

function LifestyleRecommendation({
  analysis,
  pending,
  failed,
}: {
  analysis?: QuestAnalysis;
  pending?: boolean;
  failed?: boolean;
}) {
  const { profile, hasProfileInput } = useProfileStore();
  const approved = approvedLifestyleResult(analysis?.m1);
  const presentation = approved && analysis ? bpStagePresentation(analysis.m1) : null;
  const habits = hasProfileInput
    ? [
        profile.sleepHours === null ? null : `수면 ${profile.sleepHours.toFixed(1)}시간`,
        profile.activeMinutesWeek === null ? null : `주당 활동 ${profile.activeMinutesWeek}분`,
        profile.alcoholDays === null ? null : `주당 음주 ${profile.alcoholDays}일`,
        profile.smoking === null ? null : profile.smoking ? "흡연 중" : "비흡연",
      ].filter((value): value is string => value !== null)
    : [];
  return (
    <section className="dashboard-prediction" aria-label="최종 분석 요약" data-bp-mode="lifestyle">
      <div className="prediction-meta">
        <span>생활습관 기반 측정 권고</span>
        <small>혈압 기록 없음</small>
      </div>
      <p className="prediction-sentence" role="status">
        {approved && analysis?.m1.htn_screening?.positive
          ? "혈압 확인 권고 · 측정으로 확인해 주세요"
          : "혈압을 측정해 기록해 주세요"}
      </p>
      <p className="prediction-description">
        생활습관 정보만으로 현재 혈압을 판정하지 않아요. 실제 측정값을 기록하면 수치와 추세를
        분석해요.
      </p>
      <div className="prediction-foot">
        <span>{demoMode ? "합성 생활습관 입력" : "생활습관 입력 참고"}</span>
        <RecordLink />
      </div>
      <details>
        <summary>참고한 생활습관 보기</summary>
        <div className="measurement-details">
          {habits.length ? (
            <ul>
              {habits.map((habit) => (
                <li key={habit}>{habit}</li>
              ))}
            </ul>
          ) : (
            <p>생활습관 입력을 추가해 주세요.</p>
          )}
          {presentation?.reasons.length ? (
            <p>모델이 참고한 항목: {presentation.reasons.join(" · ")}</p>
          ) : null}
          {approved && analysis ? (
            <p>생활습관 입력 기준 {analysis.as_of} · 측정 필요 여부를 참고하는 정보예요.</p>
          ) : (
            <p>
              {pending
                ? "생활습관 참고 결과를 확인하고 있어요."
                : failed || analysis
                  ? "생활습관 참고 결과를 사용할 수 없어 측정 안내를 표시해요."
                  : "생활습관 입력과 함께 혈압 측정을 시작해 주세요."}
            </p>
          )}
          <small>혈압 기록 없음은 정상 판정이 아니에요.</small>
        </div>
      </details>
    </section>
  );
}

function ConnectedLifestyleRecommendation() {
  const query = useQuestAnalysis();
  return (
    <LifestyleRecommendation
      analysis={query.data}
      pending={query.ready && !query.data && !query.isError}
      failed={query.isError}
    />
  );
}

export function DashboardPredictionBrief({
  period = "week",
  date,
  from,
}: {
  period?: HealthPeriod;
  date?: string;
  from?: string;
}) {
  const game = useGameStore((s) => s.game);
  const { profile, hasBloodPressureInput } = useProfileStore();
  const selected = date ?? game.date;
  const data = dashboardPressure(
    game,
    period,
    selected,
    from,
    hasBloodPressureInput ? profile.bloodPressure : null,
  );
  if (data.mode === "lifestyle") {
    // Current model inputs must not be presented as a historical prediction.
    return selected === game.date ? (
      <ConnectedLifestyleRecommendation />
    ) : (
      <LifestyleRecommendation />
    );
  }
  const headline = data.latest
    ? `${data.latest.systolic} / ${data.latest.diastolic} mmHg · ${data.trend ? `수축기 ${pressureChange(data.trend.systolic)}` : "추세 기록 대기"}`
    : data.undated
      ? `${data.undated.systolic} / ${data.undated.diastolic} mmHg · 측정일 미확인`
      : "선택 기간 혈압 기록이 없어요";
  return (
    <section className="dashboard-prediction" aria-label="최종 분석 요약" data-bp-mode="measured">
      <div className="prediction-meta">
        <span>혈압 측정 기록 분석</span>
        <small>
          {healthPeriods[period].label} · {data.range.start} ~ {data.range.end}
        </small>
      </div>
      <p className="prediction-sentence" role="status">
        {headline}
      </p>
      <div className="prediction-foot">
        <span>
          {demoMode ? "합성 측정 기록" : "실제 측정값 기반"} · 기록 {data.days.length}일 · 측정{" "}
          {data.readingCount}회
        </span>
        <RecordLink />
      </div>
      <details>
        <summary>측정값과 추세 자세히 보기</summary>
        <div className="measurement-details">
          <dl className="measured-vitals">
            <div>
              <dt>최근 측정</dt>
              <dd>
                {data.latest
                  ? `${data.latest.systolic} / ${data.latest.diastolic}`
                  : data.undated
                    ? `${data.undated.systolic} / ${data.undated.diastolic}`
                    : "기록 없음"}
                <small>
                  {data.latest
                    ? `${data.latest.date} ${data.latest.slot} · mmHg`
                    : data.undated
                      ? "프로필 입력 · 측정일 미확인"
                      : "선택 기간 내 기록 없음"}
                </small>
              </dd>
            </div>
            <div>
              <dt>선택 기간 평균</dt>
              <dd>
                {data.average
                  ? `${data.average.systolic.toFixed(1)} / ${data.average.diastolic.toFixed(1)}`
                  : "—"}
                <small>
                  {data.average
                    ? "mmHg · 일별 평균을 같은 비중으로 계산"
                    : "날짜별 측정 기록이 필요해요"}
                </small>
              </dd>
            </div>
          </dl>
          {data.trend ? (
            <div className="measured-trend">
              <p>{data.trend.comparison}</p>
              <strong>
                수축기 {pressureChange(data.trend.systolic)} · 이완기{" "}
                {pressureChange(data.trend.diastolic)} mmHg
              </strong>
            </div>
          ) : (
            <p>서로 비교할 측정 기록이 부족해 추세를 표시하지 않아요.</p>
          )}
          {!data.days.length && data.previous && (
            <p>
              기간 밖 이전 기록: {data.previous.date} · {data.previous.systolic.toFixed(1)} /{" "}
              {data.previous.diastolic.toFixed(1)} mmHg
            </p>
          )}
          <small>
            아침·저녁이 있으면 일별 평균으로 비교해요. 기록 없는 날과 측정일이 없는 프로필 값은 기간
            평균에 포함하지 않아요.
          </small>
        </div>
      </details>
    </section>
  );
}
