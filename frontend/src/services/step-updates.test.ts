import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  available: false,
  running: false,
  emit: undefined as ((value: unknown) => void) | undefined,
  stopped: undefined as ((value: unknown) => void) | undefined,
  remove: vi.fn(async () => undefined),
  start: vi.fn(),
  stop: vi.fn(async () => undefined),
}));
vi.mock("./native-step-sync", () => ({
  supportsNativeStepSync: () => native.available,
  nativeStepSync: {
    start: native.start,
    stop: native.stop,
    latest: vi.fn(async () => ({})),
    addListener: vi.fn(async (event: string, callback: (value: unknown) => void) => {
      if (event === "steps") native.emit = callback;
      else native.stopped = callback;
      return { remove: native.remove };
    }),
  },
}));
import { startStepUpdates } from "./step-updates";
describe("step update lifecycle", () => {
  let documentState: EventTarget & { visibilityState: string };
  let cleanup: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    native.available = false;
    native.running = false;
    native.start.mockImplementation(async () => ({ running: native.running, message: "status" }));
    documentState = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", documentState);
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("polls every five seconds, pauses hidden fallback, refreshes on return and stops on logout", async () => {
    const sync = vi.fn(async () => undefined);
    cleanup = startStepUpdates({ sync, accept: vi.fn(), status: vi.fn() });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(sync).toHaveBeenCalledTimes(4);
    documentState.visibilityState = "hidden";
    documentState.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(4);
    documentState.visibilityState = "visible";
    documentState.dispatchEvent(new Event("visibilitychange"));
    expect(sync).toHaveBeenCalledTimes(5);
    cleanup();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sync).toHaveBeenCalledTimes(5);
  });
  it("uses one native polling authority and rejects foreign or disposed session results", async () => {
    native.available = native.running = true;
    const sync = vi.fn(async () => undefined),
      accept = vi.fn();
    cleanup = startStepUpdates({ sync, accept, status: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    const { sessionId } = native.start.mock.calls[0][0];
    const sample = {
      sessionId,
      date: "2026-10-26",
      count: 6050,
      syncedAt: 100,
      source: "health-connect",
    };
    documentState.visibilityState = "hidden";
    documentState.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).not.toHaveBeenCalled();
    native.emit?.({ ...sample, sessionId: "other-account" });
    expect(accept).not.toHaveBeenCalled();
    native.emit?.(sample);
    expect(accept).toHaveBeenCalledWith(sample);
    cleanup();
    native.emit?.(sample);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(native.stop).toHaveBeenCalledWith({ sessionId });
  });
  it("keeps five-second foreground reads when background permission is denied", async () => {
    native.available = true;
    const sync = vi.fn(async () => undefined),
      status = vi.fn();
    cleanup = startStepUpdates({ sync, accept: vi.fn(), status });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(status).toHaveBeenCalledWith(expect.objectContaining({ running: false }));
    expect(sync).toHaveBeenCalledTimes(3);
  });
  it("stops a native start that finishes after session cleanup", async () => {
    native.available = true;
    let resolve!: (value: { running: boolean; message: string }) => void;
    native.start.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const status = vi.fn();
    cleanup = startStepUpdates({ sync: vi.fn(), accept: vi.fn(), status });
    await vi.advanceTimersByTimeAsync(0);
    cleanup();
    resolve({ running: true, message: "started" });
    await vi.advanceTimersByTimeAsync(0);
    expect(status).not.toHaveBeenCalled();
    expect(native.stop).toHaveBeenCalledWith(native.start.mock.calls[0][0]);
  });
  it("returns to foreground reads after service stop without starting duplicate timers", async () => {
    native.available = native.running = true;
    const sync = vi.fn(async () => undefined);
    cleanup = startStepUpdates({ sync, accept: vi.fn(), status: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    const owner = native.start.mock.calls[0][0];
    native.stopped?.(owner);
    native.stopped?.(owner);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sync).toHaveBeenCalledTimes(3);
  });
});
