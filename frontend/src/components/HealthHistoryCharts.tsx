import { useId } from "react";
import type { GameState } from "../domain/game";
import { healthPeriods, reportDateRange, type HealthPeriod } from "../services/health-history";
import { demoMode } from "../domain/demo-mode";
import { selectedDemoPersona } from "../domain/demo-personas";
type Series = { label: string; color: string; values: (number | null)[] };
function LineChart({ dates, series, unit }: { dates: string[]; series: Series[]; unit: string }) {
  const id = useId();
  const values = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (!values.length) return <p>저장된 기록이 없어요.</p>;
  const low = Math.floor((Math.min(...values) - 5) / 5) * 5,
    high = Math.ceil((Math.max(...values) + 5) / 5) * 5;
  const x = (i: number) => 34 + (i * 236) / Math.max(1, dates.length - 1),
    y = (v: number) => 100 - ((v - low) * 76) / (high - low);
  return (
    <>
      <svg className="health-record-chart" viewBox="0 0 288 130" role="img" aria-labelledby={id}>
        <title id={id}>
          {series
            .map(
              (s) =>
                s.label +
                ": " +
                s.values.map((v, i) => dates[i] + " " + (v ?? "기록 없음") + unit).join(", "),
            )
            .join("; ")}
        </title>
        {[low, high].map((value) => (
          <g key={value}>
            <line
              x1={34}
              x2={270}
              y1={y(value)}
              y2={y(value)}
              stroke="#a99e6b"
              strokeDasharray="3 4"
            />
            <text x={0} y={y(value) + 4}>
              {value}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.label} stroke={s.color} fill={s.color}>
            {s.values.map((v, i) =>
              v === null ? null : (
                <g key={i}>
                  {i > 0 && s.values[i - 1] !== null && (
                    <line
                      x1={x(i - 1)}
                      y1={y(s.values[i - 1]!)}
                      x2={x(i)}
                      y2={y(v)}
                      strokeWidth={2}
                    />
                  )}
                  <circle cx={x(i)} cy={y(v)} r={3} />
                </g>
              ),
            )}
          </g>
        ))}
        {dates.map(
          (date, i) =>
            (i === 0 || i === dates.length - 1) && (
              <text key={date} x={x(i)} y={123} textAnchor={i === 0 ? "start" : "end"}>
                {date.slice(5).replace("-", ".")}
              </text>
            ),
        )}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </>
  );
}
export function HealthHistoryCharts({
  game,
  date,
  period,
  from,
}: {
  game: GameState;
  date: string;
  period: HealthPeriod;
  from?: string;
}) {
  const range = reportDateRange(period, date, from);
  const rows = Object.entries(game.healthHistory)
    .filter(([day]) => day >= range.start && day <= range.end)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!rows.length) return null;
  const dates = rows.map(([day]) => day),
    latest = rows.at(-1)![1];
  return (
    <section className="health-history-overview" aria-label="저장된 건강 기록 추이">
      <header className="stitch-section-heading">
        <h3>{healthPeriods[period].label} 건강 기록</h3>
        <span className="pixel-tag">
          {demoMode ? `합성 ${selectedDemoPersona().records.length}일 기록` : "저장된 기록"}
        </span>
      </header>
      <article className="cream-card health-record-card">
        <header>
          <h4>혈압 추이</h4>
          <strong>
            {latest.systolic ?? "—"} / {latest.diastolic ?? "—"} <small>mmHg</small>
          </strong>
        </header>
        <LineChart
          dates={dates}
          unit="mmHg"
          series={[
            { label: "수축기", color: "#c34436", values: rows.map(([, r]) => r.systolic ?? null) },
            { label: "이완기", color: "#35576b", values: rows.map(([, r]) => r.diastolic ?? null) },
          ]}
        />
      </article>
      <div className="health-record-grid">
        <article className="cream-card health-record-card">
          <header>
            <h4>공복 혈당</h4>
            <strong>
              {latest.glucose ?? "—"}
              <small> mg/dL</small>
            </strong>
          </header>
          <LineChart
            dates={dates}
            unit="mg/dL"
            series={[
              {
                label: "공복 혈당",
                color: "#ab7030",
                values: rows.map(([, r]) => r.glucose ?? null),
              },
            ]}
          />
        </article>
        <article className="cream-card health-record-card">
          <header>
            <h4>안정 시 맥박</h4>
            <strong>
              {latest.restingHr ?? "—"}
              <small> 회/분</small>
            </strong>
          </header>
          <LineChart
            dates={dates}
            unit="회/분"
            series={[
              {
                label: "안정 시 맥박",
                color: "#205d40",
                values: rows.map(([, r]) => r.restingHr ?? null),
              },
            ]}
          />
        </article>
      </div>
      {demoMode && (
        <p className="analysis-note">
          페르소나를 위한 합성 기록이에요. 실제 환자 기록이나 치료 효과를 뜻하지 않아요.
        </p>
      )}
    </section>
  );
}
