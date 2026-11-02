import { AnimatedNumber } from "./AnimatedNumber";
import { healthPeriods, type HealthPeriod } from "../services/health-history";
import { scoreChangeText, type HealthScore } from "../domain/health-score";

export function HealthTrend({ period, result }: { period: HealthPeriod; result: HealthScore }) {
  const config = healthPeriods[period];
  return (
    <section className="health-trend" aria-label={`${config.label} 건강 점수 변화`}>
      <header>
        <h3>{config.label} 변화</h3>
        <span>기록 기반</span>
      </header>
      <div
        className="trend-bars"
        role="img"
        aria-label={result.points
          .map(
            (point) =>
              `${point.start}${point.start === point.end ? "" : ` ~ ${point.end}`} ${point.score === null ? "기록 없음" : `${point.score}점`}`,
          )
          .join(", ")}
      >
        {result.points.map((point) => (
          <div className="trend-column" key={point.start} data-missing={point.score === null}>
            <strong>{point.score === null ? "—" : <AnimatedNumber value={point.score} />}</strong>
            <div>
              {point.score !== null && (
                <i className="metric-fill" style={{ height: `${point.score}%` }} />
              )}
            </div>
            <small>{point.label}</small>
          </div>
        ))}
      </div>
      <p>
        {result.score === null ? "기록 없음" : `선택 기간 ${result.score}점`} ·{" "}
        {scoreChangeText(result, config.previous)}
        <small>저장된 기록만 계산해요. —는 기록이 없는 구간이에요.</small>
      </p>
    </section>
  );
}
