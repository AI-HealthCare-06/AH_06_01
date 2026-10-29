import { Link, useLocation } from "react-router-dom";
import { latestSurveyPressure } from "../domain/daily-survey";
import { AnimatedNumber } from "./AnimatedNumber";
import { PixelIcon } from "./PixelIcon";
import { DashboardTrends } from "./DashboardTrends";
import { useGameStore } from "../stores/game-store";
import { useProfileStore } from "../stores/profile-store";
import { mainQuestIds } from "../domain/game";
import { bloodPressurePresentation } from "../domain/risk-presentation";
import { QuestModelSummary } from "./QuestModelSummary";
import { HealthHistoryCharts } from "./HealthHistoryCharts";
import { healthPeriods, type HealthPeriod } from "../services/health-history";
import type { DashboardSnapshot } from "../services/dashboard-service";
import { healthScorePeriod, scoreChangeText } from "../domain/health-score";
import { demoMode } from "../domain/demo-mode";
import { SurveyHelp } from "./SurveyControls";

export function DashboardSummary({
  data,
  period,
  date,
  reportUrl,
  from,
}: {
  data: DashboardSnapshot;
  period: HealthPeriod;
  date: string;
  reportUrl: string;
  from?: string;
}) {
  const location = useLocation();
  const game = useGameStore((s) => s.game);
  const { profile, hasProfileInput, hasBloodPressureInput } = useProfileStore();
  const pressure = bloodPressurePresentation(data.bpResult);
  const survey = game.dailySurveys[date];
  const row = game.healthHistory[date];
  const recordedPressure = survey
    ? latestSurveyPressure(survey)
    : typeof row?.systolic === "number" && typeof row?.diastolic === "number"
      ? { systolic: row.systolic, diastolic: row.diastolic }
      : null;
  const info = healthPeriods[period];
  const current = date === game.date;
  const sleep =
    current && !game.sampleDay ? game.sleepHours : (game.healthHistory[date]?.sleepHours ?? null);
  const score = healthScorePeriod(game, period, date, from);
  const multipleDays = score.range.start !== score.range.end;
  const rings = score.metrics.map((metric) => ({
    label: { steps: "걸음 활동", quests: "퀘스트", sleep: "수면" }[metric.id],
    value: metric.percent,
    detail:
      metric.value === null
        ? "기록 없음"
        : metric.id === "quests"
          ? `${metric.total} / ${metric.days * mainQuestIds.length}`
          : `${multipleDays ? "평균 " : ""}${
              metric.id === "steps"
                ? `${Math.round(metric.value).toLocaleString("ko-KR")}보`
                : `${metric.value.toFixed(1)}시간`
            }`,
  }));
  return (
    <div className="dashboard-period-content" tabIndex={0} aria-label="대시보드 요약 스크롤">
      <section className="dashboard-summary" aria-label="유저 건강 요약">
        <section
          className="health-score summary-score stitch-health-hero"
          aria-label="유저 건강 점수"
        >
          <header>
            <h3>{info.heading} HEALTH SCORE</h3>
            <div className="score-source">
              <span className="pixel-tag">{demoMode ? "데모 기록" : "기록 기반"}</span>
              <SurveyHelp
                label="건강 점수"
                text="걸음 6,000보·메인 퀘스트 4개·수면 7시간의 일별 달성률을 각각 100%까지만 반영해 기간 평균을 내고, 세 지표를 같은 비중으로 평균해요. 기록이 없는 항목은 제외해요. 혈압 단계·모델 위험도와 별개인 생활습관 실천 점수예요."
              />
            </div>
          </header>
          <div className="hero-ring-grid">
            <div
              className="score-ring"
              role="img"
              aria-label={rings.map((ring) => `${ring.label} ${ring.detail}`).join(", ")}
            >
              <svg viewBox="0 0 280 280" aria-hidden="true" shapeRendering="geometricPrecision">
                {rings.map((ring, i) => (
                  <g key={ring.label}>
                    <circle
                      className="score-ring-track"
                      cx={140}
                      cy={140}
                      r={[120, 94, 68][i]}
                      transform="rotate(-90 140 140)"
                      fill="none"
                      strokeWidth={9}
                    />
                    <circle
                      className={`score-ring-fill ring-${i}`}
                      cx={140}
                      cy={140}
                      r={[120, 94, 68][i]}
                      transform="rotate(-90 140 140)"
                      fill="none"
                      strokeWidth={9}
                      pathLength={100}
                      strokeDasharray={`${ring.value ?? 0} 100`}
                    />
                  </g>
                ))}
              </svg>
              <div className="score-ring-value">
                <strong className="score-number">
                  {score.score === null ? "—" : <AnimatedNumber value={score.score} />}
                </strong>
                <span>/ 100</span>
              </div>
            </div>
            <dl className="hero-vitals">
              {rings.map((ring, i) => (
                <div key={ring.label} className={`ring-${i}`}>
                  <dt>
                    <i aria-hidden="true" />
                    {ring.label}
                  </dt>
                  <dd>
                    {ring.value === null ? "—" : `${ring.value}%`}
                    <small>{ring.detail}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="hero-delta">
            <span>
              {score.delta === null ? "" : score.delta > 0 ? "↑ " : score.delta < 0 ? "↓ " : "→ "}
              <b>{scoreChangeText(score, info.previous)}</b>
            </span>
            <small>
              기록 {score.recordedDays}일 · {rings.filter((ring) => ring.value !== null).length}/3
              지표
            </small>
          </p>
        </section>

        <HealthHistoryCharts game={game} date={date} period={period} from={from} />
        <DashboardTrends game={game} date={date} period={period} score={score} />

        <section
          className={`summary-pressure stitch-analysis cream-card ${pressure.tone}`}
          aria-label="혈압 요약"
        >
          <header className="stitch-section-heading">
            <div>
              <h3>
                <PixelIcon name="document" />
                혈압 기록과 판정
              </h3>
              <p>내 건강 기록 · 생활습관 참고 분석</p>
            </div>
            <Link
              className="blood-pressure-entry-button"
              to="/daily-survey"
              state={{ surveyBackground: location }}
            >
              오늘 건강 서베이
            </Link>
          </header>
          <div className="stitch-health-grid">
            <div>
              <small>선택일 혈압</small>
              <strong>
                {recordedPressure
                  ? `${recordedPressure.systolic} / ${recordedPressure.diastolic}`
                  : survey
                    ? "미측정"
                    : current && (hasProfileInput || hasBloodPressureInput)
                      ? (profile.bloodPressure ?? "모름")
                      : "기록 없음"}
              </strong>
              <small>
                {survey || recordedPressure ? `${date} · mmHg` : "프로필 최근 값 · 측정일 미확인"}
              </small>
            </div>
            <div>
              <small>안정 시 맥박</small>
              <strong>
                {survey
                  ? (survey.restingHr ?? "미측정")
                  : current && hasProfileInput
                    ? (profile.restingHeartRate ?? "모름")
                    : "기록 없음"}
              </strong>
              <small>{survey ? "선택일 기록 · 회/분" : "프로필 · 회/분"}</small>
            </div>
            <div>
              <small>수면 시간</small>
              <strong>{sleep === null ? "기록 대기" : sleep.toFixed(1)}</strong>
              <small>{sleep === null ? "선택일 수면" : "시간 · 선택일 기록"}</small>
              {game.sleepExperience[date] && (
                <small aria-label="선택일 수면 추가 EXP">
                  수면 보너스 +{game.sleepExperience[date].experience} EXP
                </small>
              )}
            </div>
          </div>
          <p className="summary-pressure-status">
            {survey ? "날짜별 직접 입력 기록 · 모델 참고 분석과 함께 확인해요." : pressure.label}
          </p>
          {pressure.tone === "red" && <small>{pressure.description}</small>}
          <QuestModelSummary />
        </section>

        <div className="stitch-quick-actions">
          <Link className="dashboard-quest-link" to="/quests">
            퀘스트 <PixelIcon name="quests" />
          </Link>
          <Link
            className="summary-report-link"
            to={reportUrl}
            aria-label="상세 건강 보고서 웹으로 보기"
          >
            상세 보고서 <span aria-hidden="true">›</span>
          </Link>
        </div>
        <small className="summary-data-note">
          {demoMode
            ? "데모 계정의 합성 기록으로 계산한 실천 점수예요."
            : "저장된 걸음·퀘스트·수면 기록으로 계산한 실천 점수예요."}{" "}
          생활습관 참고 분석은 연결된 서비스 결과를 보여드려요.
        </small>
      </section>
    </div>
  );
}
