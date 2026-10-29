import { useEffect, useState, type CSSProperties } from "react";
import "./water-success.css";

export function WaterSuccessFeedback({ sample }: { sample: boolean }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1100);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div
      className="water-success"
      role="status"
      aria-label={sample ? "시연 동작 감지" : "음수 동작 감지 완료"}
    >
      <div className="water-success-burst" aria-hidden="true">
        {Array.from({ length: 16 }, (_, i) => (
          <i key={i} style={{ "--angle": `${i * 22.5}deg` } as CSSProperties} />
        ))}
        <svg viewBox="0 0 16 16">
          <path d="M7 1h2v2h2v3h2v2h1v4h-2v2H4v-2H2V8h1V6h2V3h2z" />
        </svg>
      </div>
      <strong>{sample ? "시연 · 음수 동작 감지!" : "음수 동작 감지!"}</strong>
      <span>컵 접근 · 기울임 · 내림 완료</span>
    </div>
  );
}
