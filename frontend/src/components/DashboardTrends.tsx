import { useId, useState } from "react";
import { calendarWeek } from "../domain/calendar";
import { questCountOn, type GameState } from "../domain/game";
import type { HealthPeriod } from "../services/health-history";
import { AnimatedNumber } from "./AnimatedNumber";
import { HealthTrend } from "./HealthTrend";
import { PixelIcon } from "./PixelIcon";

const metrics = { score: "건강 점수", quests: "퀘스트", steps: "걸음 수", sleep: "수면 시간" };
type Metric = keyof typeof metrics;

export function DashboardTrends({
  game,
  date,
  period,
  from,
  score,
}: {
  game: GameState;
  date: string;
  period: HealthPeriod;
  from?: string;
  score: number;
}) {
  const [metric, setMetric] = useState<Metric>("score");
  const id = useId();
  const days = calendarWeek(date);
  const points = days.map((day) => {
    if (day.date > game.date) return null;
    if (metric === "quests")
      return day.date === game.date ||
        Object.hasOwn(game.questHistory, day.date) ||
        game.completedDates.includes(day.date)
        ? questCountOn(game, day.date)
        : null;
    if (metric === "steps")
      return game.steps?.date === day.date
        ? game.steps.count
        : (game.healthHistory[day.date]?.steps ?? null);
    return day.date === game.date && !game.sampleDay
      ? game.sleepHours
      : (game.healthHistory[day.date]?.sleepHours ?? null);
  });
  const values = points.filter((v): v is number => v !== null);
  const value = metric === "quests" ? values.reduce((sum, v) => sum + v, 0) : values.at(-1);
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
        <span className="pixel-tag">{metric === "score" ? "데모" : "내 기록"}</span>
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
                <small>데모 건강 점수</small>
                <strong>
                  <AnimatedNumber value={score} />
                  <span>/ 100</span>
                </strong>
              </div>
            </div>
            <HealthTrend period={period} today={date} from={from} />
          </>
        ) : (
          <>
            <div className="stitch-metric-value">
              <div>
                <small>{metric === "quests" ? "선택 주 완료 합계" : "선택 주의 최근 기록"}</small>
                <strong>
                  {value === undefined ? "—" : value.toLocaleString("ko-KR")}
                  <span>{unit}</span>
                </strong>
              </div>
              <small>
                {days[0].date.slice(5).replace("-", ".")} ~{" "}
                {days[6].date.slice(5).replace("-", ".")}
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
                ? "저장된 값만 표시해요. —는 기록이 없는 날이에요."
                : "아직 연결된 기록이 없어요. 기록하면 여기에 표시돼요."}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
