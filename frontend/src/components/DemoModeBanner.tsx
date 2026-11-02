import { demoMode, enterDemo, exitDemo, resetDemo } from "../domain/demo-mode";
import { cloudEnabled } from "../cloud/client";
import { selectedDemoPersona } from "../domain/demo-personas";
export function DemoModeBanner() {
  if (cloudEnabled) return null;
  return (
    <div className="demo-mode-banner">
      <small>
        {demoMode ? selectedDemoPersona().banner : "나의 기록과 분리된 데모를 체험할 수 있어요."}
      </small>
      {demoMode && selectedDemoPersona().id === "studio-quarter-v1" && (
        <button type="button" onClick={resetDemo}>
          시연 초기화
        </button>
      )}
      {demoMode && selectedDemoPersona().id !== "studio-quarter-v1" && (
        <button type="button" onClick={() => enterDemo("studio-quarter-v1")}>
          90일 시연
        </button>
      )}
      <button
        type="button"
        onClick={() => (demoMode ? exitDemo() : enterDemo("studio-quarter-v1"))}
      >
        {demoMode ? "데모 나가기" : "데모 보기"}
      </button>
    </div>
  );
}
