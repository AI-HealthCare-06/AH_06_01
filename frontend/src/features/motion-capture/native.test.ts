import { describe, it, expect, vi } from "vitest";
import { NativeObservationAdapter, nativeFrameSchema, createNativeSession } from "./native";

const { handlers, api, removed } = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown) => void>();
  const removed = vi.fn();
  return {
    handlers,
    removed,
    api: {
      addListener: vi.fn(async (name: string, cb: (event: unknown) => void) => {
        handlers.set(name, cb);
        return { remove: removed };
      }),
      start: vi.fn(async () => ({ backend: "android-native", delegate: "CPU" })),
      stop: vi.fn(async () => {}),
      setProgress: vi.fn(async () => {}),
    },
  };
});
vi.mock("@capacitor/core", () => ({
  registerPlugin: () => api,
  Capacitor: { getPlatform: () => "android", isPluginAvailable: () => true },
}));
function frame(timestamp = 1000) {
  return nativeFrameSchema.parse({
    sessionId: "session-A",
    timestamp,
    frameWidth: 640,
    frameHeight: 480,
    faces: [
      [
        { index: 13, x: 0.5, y: 0.4 },
        { index: 14, x: 0.5, y: 0.4 },
        { index: 234, x: 0.25, y: 0.4 },
        { index: 454, x: 0.75, y: 0.4 },
      ],
    ],
    hands: [],
    detections: [
      { x: 288, y: 216, width: 96, height: 120, categories: [{ categoryName: "cup", score: 0.8 }] },
    ],
    objectObservedAt: timestamp,
    latencyMs: 40,
    frames: 1,
    throttledFrames: 2,
    p50Ms: 40,
    p95Ms: 40,
    delegate: "CPU",
  });
}
describe("native camera bridge", () => {
  it("aligns monotonic clocks and rejects duplicate or out-of-order frames", () => {
    const adapter = new NativeObservationAdapter("water");
    const first = adapter.update(frame(), 10000)!;
    expect(first.observation.timestamp).toBe(9960);
    expect(adapter.update(frame(), 20000)).toBeNull();
    expect(adapter.update(frame(999), 20000)).toBeNull();
    expect(adapter.update(frame(1100), 30000)!.observation.timestamp).toBe(10060);
    expect(first.observation.mouth).not.toBeNull();
    expect(first.process.tools?.modelReady).toBe(false);
  });
  it("invalidates tracking after orientation changes", () => {
    const adapter = new NativeObservationAdapter("water");
    adapter.update(frame());
    const rotated = { ...frame(1200), frameWidth: 480, frameHeight: 640 };
    expect(adapter.update(rotated)!.observation.trackingChanged).toBe(true);
  });
  it("isolates stale sessions, validates bridge data, and removes only its listeners", async () => {
    const onFrame = vi.fn(),
      onError = vi.fn();
    const session = createNativeSession({
      sessionId: "session-A",
      quest: "water",
      injection: false,
      onFrame,
      onError,
      onTap: vi.fn(),
      onStop: vi.fn(),
    });
    await session.start();
    handlers.get("motionFrame")!({ ...frame(), sessionId: "stale", timestamp: NaN });
    expect(onError).not.toHaveBeenCalled();
    handlers.get("motionFrame")!(frame());
    expect(onFrame).toHaveBeenCalledTimes(1);
    handlers.get("motionFrame")!({ ...frame(1200), latencyMs: NaN });
    expect(onError).toHaveBeenCalledTimes(1);
    session.stop();
    session.stop();
    expect(removed).toHaveBeenCalledTimes(5);
    handlers.get("motionFrame")!(frame(1500));
    expect(onFrame).toHaveBeenCalledTimes(1);
  });
});
