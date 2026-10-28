import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { StepSnapshot } from "../domain/game";

export type NativeStepStatus = { running: boolean; message: string };
type NativeStepSnapshot = StepSnapshot & { sessionId: string };
export const nativeStepSync = registerPlugin<{
  authorize(): Promise<NativeStepStatus>;
  start(options: { sessionId: string }): Promise<NativeStepStatus>;
  stop(options: { sessionId: string }): Promise<void>;
  latest(options: { sessionId: string }): Promise<Partial<NativeStepSnapshot>>;
  addListener(
    event: "steps",
    listener: (value: NativeStepSnapshot) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "stopped",
    listener: (value: { sessionId: string }) => void,
  ): Promise<PluginListenerHandle>;
}>("StepSync");

export const supportsNativeStepSync = () =>
  Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("StepSync");

export async function authorizeBackgroundSteps() {
  if (!supportsNativeStepSync()) return;
  return nativeStepSync.authorize();
}
