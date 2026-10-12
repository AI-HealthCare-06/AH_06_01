import { localDate } from "../domain/calendar";
import { AnimatedNumber } from "./AnimatedNumber";
import { healthPeriods } from "../services/health-history";
import type { HealthPeriod } from "../services/health-history";

export function HealthTrend({ period, today }: { period: HealthPeriod; today: string }) {
  const config = healthPeriods[period];
  const labels = config.values.map((_, index) => {
    if (period === "day") return ["아침", "오전", "오후", "저녁"][index];
    const day = new Date(`${today}T12:00:00`);
    if (period === "year") {
      day.setDate(1);
      day.setMonth(day.getMonth() - 11 + index);
      return `${day.getMonth() + 1}월`;
    }
    day.setDate(day.getDate() - (config.values.length - 1 - index) * (period === "month" ? 7 : 1));
    return localDate(day).slice(5).replace("-", ".");
  });
  return (
    <section className="health-trend" aria-label={`${config.label} 건강 점수 변화`}>
      <header>
        <h3>{config.label} 변화</h3>
        <span>데모 데이터</span>
      </header>
      <div
        className="trend-bars"
        role="img"
        aria-label={config.values.map((v, i) => `${labels[i]} ${v}점`).join(", ")}
      >
        {config.values.map((value, index) => (
          <div className="trend-column" key={index}>
            <strong>
              <AnimatedNumber value={value} />
            </strong>
            <div>
              <i className="metric-fill" style={{ height: `${value}%` }} />
            </div>
            <small>{labels[index]}</small>
          </div>
        ))}
      </div>
      <p>
        현재 82점 · {config.previous} 대비 <b>+{config.delta}점</b>
        <small>실제 건강 기록이 연결되면 내 변화량을 보여드려요.</small>
      </p>
    </section>
  );
}
