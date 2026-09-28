import type { RiskTone } from "../services/dashboard-service";
import { AnimatedNumber } from "./AnimatedNumber";

// Presentation colors only; risk categories come from the supplied dataset/API.
const colors: Record<RiskTone, string> = { green: "#2b7a4b", amber: "#b7790c", red: "#c33d30" };
export function RiskChange({
  current,
  projected,
  tone,
  projectedTone,
}: {
  current: number;
  projected: number;
  tone: RiskTone;
  projectedTone: RiskTone;
}) {
  const delta = projected - current;
  return (
    <div
      className="risk-change"
      aria-label={`현재 ${current}%, 완료 후 ${projected}%, ${Math.abs(delta)}%포인트 ${delta < 0 ? "감소" : delta > 0 ? "증가" : "변화 없음"}`}
    >
      <div className="risk-change-values">
        <strong style={{ color: colors[tone] }}>
          <AnimatedNumber value={current} />%
        </strong>
        <span
          className="risk-change-arrow"
          aria-hidden="true"
          style={{
            backgroundImage: `linear-gradient(90deg, ${colors[tone]}, ${colors[projectedTone]})`,
          }}
        >
          →
        </span>
        <strong style={{ color: colors[projectedTone] }}>
          <AnimatedNumber value={projected} />%
        </strong>
      </div>
      <small>
        {delta < 0 ? "−" : delta > 0 ? "+" : ""}
        <AnimatedNumber value={Math.abs(delta)} />
        %p
      </small>
    </div>
  );
}
