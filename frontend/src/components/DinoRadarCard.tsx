import { Link } from "react-router-dom";
import { assets } from "../design/assets";
import { radarData } from "../domain/dino-radar";
import { useGameStore } from "../stores/game-store";
import { useId } from "react";

const center = { x: 85, y: 70 };
function point(value: number | null, index: number) {
  const angle = ((index * 60 - 90) * Math.PI) / 180;
  const radius = (52 * Math.max(0, Math.min(100, value ?? 0))) / 100;
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}
function polygon(values: readonly (number | null)[]) {
  return values
    .map(point)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
}

export function DinoRadarCard({ linked = true }: { linked?: boolean } = {}) {
  const game = useGameStore((s) => s.game);
  const { axes, dayOne, today, first, elapsed } = radarData(game);
  const titleId = useId(),
    descriptionId = useId();
  const labels = [
    { x: 85, y: 9 },
    { x: 150, y: 47 },
    { x: 150, y: 98 },
    { x: 85, y: 133 },
    { x: 20, y: 98 },
    { x: 20, y: 47 },
  ];
  const content = (
    <>
      <div className="radar-heading">
        <img src={assets.home.imgPixelIconRadar} alt="" />
        <h3>DINO RADAR</h3>
        <img src={assets.home.imgOpenChevron1} alt="" />
      </div>
      <div className="radar-legend">
        <span>
          <i className="baseline-key" />첫 기록 {first.slice(5)}
        </span>
        <span>
          <i className="today-key" />
          {elapsed}일차 · 오늘
        </span>
      </div>
      <svg
        className="radar-comparison"
        viewBox="0 0 170 140"
        shapeRendering="geometricPrecision"
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <title id={titleId}>첫 기록과 오늘의 실천 기록 비교</title>
        <desc id={descriptionId}>
          저장된 실천 기록 비율. 빈 축은 기록 없음.{" "}
          {axes
            .map(
              (axis, i) =>
                `${axis}: 1일차 ${dayOne[i] ?? "기록 없음"}, 오늘 ${today[i] ?? "기록 없음"}`,
            )
            .join(". ")}
        </desc>
        {[25, 50, 75, 100].map((value) => (
          <polygon key={value} className="radar-grid" points={polygon(axes.map(() => value))} />
        ))}
        {axes.map((axis, i) => {
          const end = point(100, i);
          return (
            <line
              key={axis}
              className="radar-axis"
              x1={center.x}
              y1={center.y}
              x2={end.x}
              y2={end.y}
            />
          );
        })}
        <g className="radar-series radar-current">
          <polygon className="radar-today-series" data-series="today" points={polygon(today)} />
          {today.map((value, i) => {
            if (value === null) return null;
            const p = point(value, i);
            return (
              <rect
                key={i}
                className="radar-point"
                shapeRendering="crispEdges"
                x={Math.round(p.x / 2) * 2 - 2}
                y={Math.round(p.y / 2) * 2 - 2}
                width={4}
                height={4}
              />
            );
          })}
        </g>
        <g className="radar-series radar-baseline">
          <polygon
            className="radar-baseline-series"
            data-series="day-one"
            points={polygon(dayOne)}
          />
        </g>
        {axes.map((axis, i) => (
          <text
            key={axis}
            x={labels[i].x}
            y={labels[i].y}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {axis}
          </text>
        ))}
      </svg>
    </>
  );
  return linked ? (
    <Link to="/dashboard" className="radar-card" aria-label="DINO RADAR · 건강 대시보드 보기">
      {content}
    </Link>
  ) : (
    <div className="radar-card">{content}</div>
  );
}
