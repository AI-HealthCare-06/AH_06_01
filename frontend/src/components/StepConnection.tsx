import { useDeviceStore } from "../stores/device-store";
import { useGameStore } from "../stores/game-store";
import { stepPlatform } from "../services/device-steps";

export function StepConnection() {
  const { enabled, busy, message, sync, disconnect } = useDeviceStore();
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
        {steps && (
          <small>
            최근 동기화{" "}
            {new Date(steps.syncedAt).toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </small>
        )}
      </div>
      {!web && (
        <div className="step-actions">
          <button disabled={busy} onClick={() => void sync(true)}>
            {busy ? "연결 중…" : enabled ? "다시 동기화" : "걸음 수 연결"}
          </button>
          {enabled && <button onClick={disconnect}>연동 끄기</button>}
        </div>
      )}
    </section>
  );
}
