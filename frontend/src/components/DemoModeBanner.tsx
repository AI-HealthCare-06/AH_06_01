import { demoMode, enterDemo, exitDemo } from "../domain/demo-mode";
import { cloudEnabled } from "../cloud/client";
import { selectedDemoPersona } from "../domain/demo-personas";
export function DemoModeBanner() {
  if (cloudEnabled) return null;
  return (
    <div className="demo-mode-banner">
      <small>
        {demoMode ? selectedDemoPersona().banner : "나의 기록과 분리된 데모를 체험할 수 있어요."}
      </small>
      <button type="button" onClick={() => (demoMode ? exitDemo() : enterDemo("office-month-v1"))}>
        {demoMode ? "데모 나가기" : "데모 보기"}
      </button>
    </div>
  );
}
