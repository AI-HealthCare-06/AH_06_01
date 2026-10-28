import { useDeviceStore } from "../stores/device-store";
import { useGameStore } from "../stores/game-store";
import { stepPlatform } from "../services/device-steps";
import { Health } from "@capgo/capacitor-health";

export function StepConnection() {
  const { enabled, busy, message, backgroundMessage, sync, disconnect } = useDeviceStore();
  const steps = useGameStore((state) => state.game.steps);
  const web = stepPlatform() === "web";
  return (
    <section className="step-connection" aria-label="걸음 수 연결">
      <div>
        <strong>
          {steps?.source === "healthkit"
            ? "APPLE HEALTH"
            : steps?.source === "health-connect"
              ? "HEALTH CONNECT"
              : "AUTO STEP QUEST"}
        </strong>
        <p role="status">{message}</p>
        {enabled && backgroundMessage && <small>{backgroundMessage}</small>}
        {steps && (
          <small>
            최근 동기화{" "}
            {new Date(steps.syncedAt).toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </small>
        )}
        <p className="galaxy-step-guide">
          갤럭시: 삼성 헬스에서 Health Connect에 걸음 수를 공유한 뒤, REXRUN의 걸음 수 읽기를 허용해
          주세요. 워치 기록은 삼성 헬스에 동기화된 후 반영돼요.
        </p>
      </div>
      {!web && (
        <div className="step-actions">
          <button disabled={busy} onClick={() => void sync(true)}>
            {busy ? "연결 중…" : enabled ? "다시 동기화" : "걸음 수 연결"}
          </button>
          {enabled && <button onClick={disconnect}>연동 끄기</button>}
          {stepPlatform() === "android" && (
            <button onClick={() => void Health.openHealthConnectSettings().catch(() => undefined)}>
              Health Connect 설정
            </button>
          )}
        </div>
      )}
    </section>
  );
}
