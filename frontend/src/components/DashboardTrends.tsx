import { useId, useState } from "react";
import type { GameState } from "../domain/game";
import { dashboardInsights, mean } from "../domain/dashboard-insights";
import type { HealthPeriod } from "../services/health-history";
import { AnimatedNumber } from "./AnimatedNumber";
import { HealthTrend } from "./HealthTrend";
import { PixelIcon } from "./PixelIcon";
import type { HealthScore } from "../domain/health-score";

const metrics = { score: "건강 점수", quests: "퀘스트", steps: "걸음 수", sleep: "수면 시간" };
type Metric = keyof typeof metrics;

export function DashboardTrends({
  game,
  date,
  period,
  score,
}: {
  game: GameState;
  date: string;
  period: HealthPeriod;
  score: HealthScore;
}) {
  const [metric, setMetric] = useState<Metric>("score");
  const id = useId();
  const rows = dashboardInsights(game, [], period, date, score.range.start).rows;
  const days = score.points.map((point) => ({
    date: point.start,
    label: point.label,
    end: point.end,
  }));
  const field = metric === "quests" ? "completed" : metric === "steps" ? "steps" : "sleep";
  const points = days.map((day) => {
    const v = mean(
      rows.filter((r) => r.date >= day.date && r.date <= day.end).map((r) => r[field]),
    );
    return v === null ? null : Number(v.toFixed(metric === "steps" ? 0 : 1));
  });
  const values = points.filter((v): v is number => v !== null);
  const recorded = rows.map((r) => r[field]).filter((v): v is number => v !== null);
  const value =
    metric === "quests"
      ? recorded.length
        ? recorded.reduce((a, b) => a + b, 0)
        : null
      : mean(recorded);
  const ceiling = Math.max(metric === "quests" ? 4 : metric === "steps" ? 6000 : 7, ...values);
  const unit = metric === "quests" ? "개" : metric === "steps" ? "보" : "시간";
  return (
    <section className="stitch-trends cream-card" aria-labelledby={`${id}-title`}>
      <header className="stitch-section-heading">
        <div>
          <small>HEALTH TELEMETRY</small>
          <h3 id={`${id}-title`}>
            <PixelIcon name="dashboard" />
            핵심 수치 변화 추이
          </h3>
        </div>
        <span className="pixel-tag">기록 기반</span>
      </header>
      <div className="stitch-metric-tabs" role="group" aria-label="변화 추이 항목" data-no-swipe>
        {(Object.entries(metrics) as [Metric, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={key === metric}
            aria-controls={`${id}-chart`}
            onClick={() => setMetric(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id={`${id}-chart`}
        className="stitch-metric-panel"
        role="region"
        aria-label="선택한 지표"
        data-metric={metric}
        aria-live="polite"
      >
        {metric === "score" ? (
          <>
            <div className="stitch-metric-value">
              <div>
                <small>선택 기간 실천 점수</small>
                <strong>
                  {score.score === null ? "—" : <AnimatedNumber value={score.score} />}
                  <span>/ 100</span>
                </strong>
              </div>
            </div>
            <HealthTrend period={period} result={score} />
          </>
        ) : (
          <>
            <div className="stitch-metric-value">
              <div>
                <small>{metric === "quests" ? "선택 기간 완료 합계" : "선택 기간 기록 평균"}</small>
                <strong>
                  {value === null
                    ? "—"
                    : value.toLocaleString("ko-KR", {
                        maximumFractionDigits: metric === "sleep" ? 1 : 0,
                      })}
                  <span>{unit}</span>
                </strong>
              </div>
              <small>
                {days[0].date.slice(5).replace("-", ".")} ~{" "}
                {score.range.end.slice(5).replace("-", ".")}
              </small>
            </div>
            <div
              className="stitch-telemetry-bars"
              role="img"
              aria-label={days
                .map(
                  (day, i) =>
                    `${day.date} ${points[i] === null ? "기록 없음" : `${points[i]}${unit}`}`,
                )
                .join(", ")}
            >
              {days.map((day, i) => (
                <div
                  key={day.date}
                  className="stitch-telemetry-column"
                  data-missing={points[i] === null}
                >
                  <strong>{points[i] === null ? "—" : points[i]!.toLocaleString("ko-KR")}</strong>
                  <div>
                    <i style={{ height: `${((points[i] ?? 0) / ceiling) * 100}%` }} />
                  </div>
                  <small>{day.label}</small>
                </div>
              ))}
            </div>
            <p className="stitch-chart-note">
              {values.length
                ? "막대는 구간별 일평균이에요. —는 기록이 없는 구간이에요."
                : "아직 연결된 기록이 없어요. 기록하면 여기에 표시돼요."}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
