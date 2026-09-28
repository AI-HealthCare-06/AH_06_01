import { AnimatedNumber } from "./AnimatedNumber";

export function QuestProgress({
  label,
  progress,
  done,
  delay = 0,
}: {
  label: string;
  progress: number;
  done: boolean;
  delay?: number;
}) {
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div className={`quest-progress-line ${done ? "complete" : ""}`}>
      <div
        className="quest-row-progress"
        role="progressbar"
        aria-label={`${label} 진행도`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={done ? "100%, 완료" : `${percent}%`}
      >
        <i className="metric-fill" style={{ width: `${percent}%`, animationDelay: `${delay}ms` }} />
      </div>
      <span className="quest-progress-percent" aria-hidden="true">
        <AnimatedNumber value={percent} delay={delay} />%
      </span>
    </div>
  );
}

export function PixelCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`checkbox ${checked ? "checked" : ""}`}
      role="img"
      aria-label={checked ? "완료" : "진행 중"}
    >
      {checked && (
        <svg
          className="pixel-check"
          viewBox="0 0 16 12"
          shapeRendering="crispEdges"
          aria-hidden="true"
        >
          <path d="M12 0h4v2h-2v2h-2v2h-2v2H8v4H4v-2H2V8H0V6h4v2h2V6h2V4h2V2h2z" />
        </svg>
      )}
    </span>
  );
}
