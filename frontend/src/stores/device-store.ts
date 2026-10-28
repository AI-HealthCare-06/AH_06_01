import { appStorageKey, demoMode } from "../domain/demo-mode";
import { create } from "zustand";
import { readDeviceSteps, stepPlatform } from "../services/device-steps";
import { useGameStore } from "./game-store";
import { useSessionStore } from "./session-store";
import type { StepSnapshot } from "../domain/game";
import { authorizeBackgroundSteps } from "../services/native-step-sync";

const preferenceKey = appStorageKey("rexrun-device-steps-enabled");
function enabled() {
  try {
    return localStorage.getItem(preferenceKey) === "true";
  } catch {
    return false;
  }
}
type DeviceState = {
  enabled: boolean;
  busy: boolean;
  message: string;
  backgroundMessage: string;
  backgroundRevision: number;
  acceptSnapshot: (snapshot: StepSnapshot) => void;
  sync: (requestPermission?: boolean) => Promise<void>;
  disconnect: () => void;
};
let generation = 0;
useSessionStore.subscribe((next, previous) => {
  if (next.active !== previous.active) {
    generation++;
    useDeviceStore.setState((state) => ({
      busy: false,
      backgroundRevision: state.backgroundRevision + 1,
    }));
  }
});
export const useDeviceStore = create<DeviceState>((set, get) => ({
  enabled: enabled(),
  busy: false,
  backgroundMessage: "",
  backgroundRevision: 0,
  acceptSnapshot: (snapshot) => {
    if (demoMode || !useSessionStore.getState().active || !useDeviceStore.getState().enabled)
      return;
    useGameStore.getState().syncSteps(snapshot);
    set({ message: "연결됨 · 걸음 수를 자동 갱신하고 있어요." });
  },
  message:
    stepPlatform() === "web"
      ? "Android·iPhone 앱에서 걸음 수를 연결해 주세요."
      : "오늘의 걸음 수를 연결하면 6,000걸음에 자동 완료돼요.",
  sync: async (requestPermission = false) => {
    if (demoMode) {
      set({ message: "데모는 합성 걸음 기록을 사용해요." });
      return;
    }
    if (!useSessionStore.getState().active || get().busy || (!requestPermission && !get().enabled))
      return;
    const token = generation;
    set({ busy: true });
    try {
      const snapshot = await readDeviceSteps(requestPermission);
      if (token !== generation || !useSessionStore.getState().active) return;
      if (snapshot) useGameStore.getState().syncSteps(snapshot);
      try {
        localStorage.setItem(preferenceKey, "true");
      } catch {
        /* Optional persistence. */
      }
      set({
        enabled: true,
        message: snapshot
          ? "연결됨 · 앱 사용 중 5초마다 갱신해요."
          : "아직 읽을 수 있는 기록이 없어요. 건강 앱의 걸음 수와 접근 권한을 확인해 주세요.",
      });
      if (requestPermission) {
        try {
          const result = await authorizeBackgroundSteps();
          if (token === generation && useSessionStore.getState().active)
            set((state) => ({
              backgroundRevision: state.backgroundRevision + 1,
              ...(result ? { backgroundMessage: result.message } : {}),
            }));
        } catch {
          if (token === generation)
            set({
              backgroundMessage: "앱에서는 5초마다 갱신해요. 백그라운드 권한을 다시 확인해 주세요.",
            });
        }
      }
    } catch (error) {
      if (token === generation)
        set({
          message: error instanceof Error ? error.message : "걸음 수 연결을 다시 시도해 주세요.",
        });
    } finally {
      if (token === generation) set({ busy: false });
    }
  },
  disconnect: () => {
    generation++;
    try {
      localStorage.removeItem(preferenceKey);
    } catch {
      /* Optional persistence. */
    }
    set({
      enabled: false,
      busy: false,
      backgroundMessage: "",
      message: "자동 동기화를 껐어요. 접근 권한은 기기의 건강 설정에서 관리할 수 있어요.",
    });
  },
}));
