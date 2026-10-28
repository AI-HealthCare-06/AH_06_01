import type { PluginListenerHandle } from "@capacitor/core";
import type { StepSnapshot } from "../domain/game";
import { nativeStepSync, supportsNativeStepSync, type NativeStepStatus } from "./native-step-sync";

/** Android owns its 5s/30s timer. Other clients poll only while visible. */
export function startStepUpdates({
  sync,
  accept,
  status,
}: {
  sync: () => Promise<void>;
  accept: (snapshot: StepSnapshot) => void;
  status: (value: NativeStepStatus) => void;
}) {
  const sessionId = crypto.randomUUID();
  let disposed = false;
  let nativeRunning = false;
  let nativeStopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let listener: PluginListenerHandle | undefined;
  let stoppedListener: PluginListenerHandle | undefined;
  const refresh = () => {
    if (!disposed && !nativeRunning && document.visibilityState === "visible") void sync();
  };
  const fallback = () => {
    if (timer !== undefined) return;
    refresh();
    timer = setInterval(refresh, 5_000);
  };
  document.addEventListener("visibilitychange", refresh);
  if (supportsNativeStepSync()) {
    void (async () => {
      try {
        listener = await nativeStepSync.addListener("steps", (snapshot) => {
          if (!disposed && snapshot.sessionId === sessionId) accept(snapshot);
        });
        if (disposed) return;
        stoppedListener = await nativeStepSync.addListener("stopped", (event) => {
          if (disposed || event.sessionId !== sessionId) return;
          nativeStopped = true;
          nativeRunning = false;
          status({
            running: false,
            message: "백그라운드 연결이 중단됐어요. 앱에서는 5초마다 갱신해요.",
          });
          fallback();
        });
        if (disposed) return;
        const result = await nativeStepSync.start({ sessionId });
        if (disposed) return;
        nativeRunning = result.running && !nativeStopped;
        if (!nativeStopped) status(result);
        if (nativeRunning) {
          const snapshot = await nativeStepSync.latest({ sessionId });
          if (!disposed && snapshot.sessionId === sessionId && typeof snapshot.count === "number")
            accept(snapshot as StepSnapshot);
        } else fallback();
      } catch {
        if (!disposed) {
          nativeRunning = false;
          await nativeStepSync.stop({ sessionId }).catch(() => undefined);
          status({
            running: false,
            message: "앱에서는 5초마다 갱신해요. 백그라운드 연결을 다시 확인해 주세요.",
          });
          fallback();
        }
      } finally {
        if (disposed) {
          await listener?.remove().catch(() => undefined);
          await stoppedListener?.remove().catch(() => undefined);
          await nativeStepSync.stop({ sessionId }).catch(() => undefined);
        }
      }
    })();
  } else {
    status({
      running: false,
      message:
        "앱 사용 중 5초마다 갱신해요. 백그라운드 갱신은 새 Android APK와 추가 권한이 필요해요.",
    });
    fallback();
  }
  return () => {
    disposed = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", refresh);
    void listener?.remove().catch(() => undefined);
    void stoppedListener?.remove().catch(() => undefined);
    if (supportsNativeStepSync()) void nativeStepSync.stop({ sessionId }).catch(() => undefined);
  };
}
