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
  return values
    .map((value, index) => {
      const p = point(value, index);
      return `${p.x},${p.y}`;
    })
    .join(" ");
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
            const p = point(value, i);
            return <circle key={i} className="radar-point" cx={p.x} cy={p.y} r={2.5} />;
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
