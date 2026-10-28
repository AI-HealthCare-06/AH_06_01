import { demoMode, enterDemo, exitDemo } from "../domain/demo-mode";
import { cloudEnabled } from "../cloud/client";
export function DemoModeBanner() {
  if (cloudEnabled) return null;
  return (
    <div className="demo-mode-banner">
      <small>
        {demoMode
          ? "DEMO · 고혈압·당뇨 페르소나 / 합성 7일 기록"
          : "나의 기록과 분리된 데모를 체험할 수 있어요."}
      </small>
      <button type="button" onClick={demoMode ? exitDemo : enterDemo}>
        {demoMode ? "데모 나가기" : "데모 보기"}
      </button>
    </div>
  );
}
