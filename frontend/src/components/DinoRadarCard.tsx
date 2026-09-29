import { Link } from "react-router-dom";
import { assets } from "../design/assets";
import { dinoRadarDemo } from "../services/dino-radar-data";

const center = { x: 85, y: 70 };
function point(value: number, index: number) {
  const angle = ((index * 60 - 90) * Math.PI) / 180;
  const radius = (52 * Math.max(0, Math.min(100, value))) / 100;
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}
function polygon(values: readonly number[]) {
  const points = values.map(point);
  return points.map((p, i) => staircase(p, points[(i + 1) % points.length])).join(" ");
}
function staircase(from: { x: number; y: number }, to: { x: number; y: number }) {
  const snap = (v: number) => Math.round(v / 2) * 2;
  const count = Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / 2);
  let x = snap(from.x),
    y = snap(from.y);
  const result = [`${x},${y}`];
  for (let i = 1; i <= count; i++) {
    x = snap(from.x + ((to.x - from.x) * i) / count);
    result.push(`${x},${y}`);
    y = snap(from.y + ((to.y - from.y) * i) / count);
    result.push(`${x},${y}`);
  }
  return result.join(" ");
}

export function DinoRadarCard() {
  const { axes, dayOne, today } = dinoRadarDemo;
  const labels = [
    { x: 85, y: 9 },
    { x: 150, y: 47 },
    { x: 150, y: 98 },
    { x: 85, y: 133 },
    { x: 20, y: 98 },
    { x: 20, y: 47 },
  ];
  return (
    <Link to="/dashboard" className="radar-card">
      <div className="radar-heading">
        <img src={assets.home.imgPixelIconRadar} alt="" />
        <h3>DINO RADAR</h3>
        <img src={assets.home.imgOpenChevron1} alt="" />
      </div>
      <div className="radar-legend">
        <span>
          <i className="baseline-key" />
          1일차
        </span>
        <span>
          <i className="today-key" />
          72일차(오늘)
        </span>
      </div>
      <svg
        className="radar-comparison"
        viewBox="0 0 170 140"
        shapeRendering="crispEdges"
        role="img"
        aria-labelledby="dino-radar-title"
        aria-describedby="dino-radar-description"
      >
        <title id="dino-radar-title">1일차와 오늘의 공룡 능력치 비교</title>
        <desc id="dino-radar-description">
          데모 데이터.{" "}
          {axes.map((axis, i) => `${axis}: 1일차 ${dayOne[i]}, 오늘 ${today[i]}`).join(". ")}
        </desc>
        {[25, 50, 75, 100].map((value) => (
          <polygon key={value} className="radar-grid" points={polygon(axes.map(() => value))} />
        ))}
        {axes.map((axis, i) => {
          const end = point(100, i);
          return <polyline key={axis} className="radar-axis" points={staircase(center, end)} />;
        })}
        <g className="radar-series radar-current">
          <polygon className="radar-today-series" data-series="today" points={polygon(today)} />
          {today.map((value, i) => {
            const p = point(value, i);
            return (
              <rect
                key={i}
                className="radar-point"
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
    </Link>
  );
}
