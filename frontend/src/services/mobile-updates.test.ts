vi.mock("./update-notifications", () => ({
  notifyUpdateAvailable: vi.fn(async () => {}),
  startUpdateNotificationRouting: vi.fn(async () => {}),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  platform: "android",
  ready: vi.fn(),
  current: vi.fn(),
  list: vi.fn(),
  download: vi.fn(),
  cancelDelay: vi.fn(),
  set: vi.fn(),
  listener: vi.fn(),
  progress: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => native.platform } }));
vi.mock("@capacitor/app", () => ({
  App: { getInfo: vi.fn(async () => ({ version: "1.3.0" })), addListener: native.listener },
}));
vi.mock("@capgo/capacitor-updater", () => ({
  CapacitorUpdater: {
    notifyAppReady: native.ready,
    current: native.current,
    list: native.list,
    download: native.download,
    cancelDelay: native.cancelDelay,
    set: native.set,
    addListener: native.progress,
  },
}));
vi.mock("../../mobile-updates.config.json", () => ({
  default: {
    projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
    bucket: "rexrun-app-updates",
    channel: "galaxy-test",
    nativeVersion: "1.3.0",
    publicKey: "public-key",
  },
}));
vi.mock("../domain/mobile-update", async (original) => ({
  ...(await original<typeof import("../domain/mobile-update")>()),
  verifyMobileManifest: native.verify,
}));

describe("mobile update lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    native.platform = "android";
    native.ready.mockResolvedValue({});
    native.current.mockResolvedValue({ bundle: { version: "builtin" } });
    native.list.mockResolvedValue({ bundles: [] });
    native.download.mockResolvedValue({ id: "new-bundle", version: "1.3.1", status: "pending" });
    native.cancelDelay.mockResolvedValue(undefined);
    native.set.mockResolvedValue({});
    native.listener.mockResolvedValue({ remove: vi.fn() });
    native.progress.mockResolvedValue({ remove: vi.fn() });
    native.verify.mockResolvedValue({
      version: "1.3.1",
      files: [
        {
          file_name: "index.html",
          file_hash: "a".repeat(64),
          download_url:
            "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/rexrun-app-updates/files/" +
            "a".repeat(64),
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("acknowledges app readiness before the network check, once per WebView", async () => {
    const { startMobileUpdates, checkMobileUpdates } = await import("./mobile-updates");
    await Promise.all([startMobileUpdates(), startMobileUpdates()]);
    const check = checkMobileUpdates();
    await vi.runAllTimersAsync();
    await check;
    expect(native.ready).toHaveBeenCalledTimes(1);
    expect(native.ready.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fetch).mock.invocationCallOrder[0],
    );
  });
  it("shows a brief notice, saves current state, and applies without a process restart", async () => {
    const { checkMobileUpdates, useMobileUpdateStore, beforeMobileUpdateApply } =
      await import("./mobile-updates");
    const save = vi.fn();
    beforeMobileUpdateApply(save);
    const checks = Promise.all([checkMobileUpdates(true), checkMobileUpdates(true)]);
    await vi.advanceTimersByTimeAsync(1799);
    expect(native.download).toHaveBeenCalledTimes(1);
    expect(useMobileUpdateStore.getState().phase).toBe("applying");
    expect(native.set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await checks;
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(native.set.mock.invocationCallOrder[0]);
    expect(native.cancelDelay).toHaveBeenCalledOnce();
    expect(native.set).toHaveBeenCalledExactlyOnceWith({ id: "new-bundle" });
  });
  it("applies an already downloaded signed bundle without downloading again", async () => {
    native.list.mockResolvedValue({
      bundles: [{ id: "cached", version: "1.3.1", status: "pending" }],
    });
    const { checkMobileUpdates } = await import("./mobile-updates");
    const check = checkMobileUpdates(true);
    await vi.runAllTimersAsync();
    await check;
    expect(native.download).not.toHaveBeenCalled();
    expect(native.set).toHaveBeenCalledExactlyOnceWith({ id: "cached" });
    expect(native.verify.mock.invocationCallOrder[0]).toBeLessThan(
      native.set.mock.invocationCallOrder[0],
    );
  });
  it("uses the embedded web version when the native builtin reports the app version", async () => {
    native.current.mockResolvedValue({ bundle: { id: "builtin", version: "1.0.0" } });
    native.verify.mockResolvedValue({ version: "1.0.0", files: [] });
    const { checkMobileUpdates, useMobileUpdateStore } = await import("./mobile-updates");
    await checkMobileUpdates(true);
    expect(useMobileUpdateStore.getState().currentVersion).toBe("1.3.0");
    expect(native.download).not.toHaveBeenCalled();
  });
  it("holds activation in the background and applies automatically on return", async () => {
    let finish: (bundle: { id: string }) => void = () => {};
    native.download.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { startMobileUpdates, checkMobileUpdates, useMobileUpdateStore } =
      await import("./mobile-updates");
    await startMobileUpdates();
    await vi.advanceTimersByTimeAsync(0);
    const onState = native.listener.mock.calls[0][1];
    onState({ isActive: false });
    finish({ id: "cached" });
    await checkMobileUpdates();
    expect(useMobileUpdateStore.getState().phase).toBe("ready");
    expect(native.set).not.toHaveBeenCalled();
    native.list.mockResolvedValue({
      bundles: [{ id: "cached", version: "1.3.1", status: "pending" }],
    });
    onState({ isActive: true });
    const check = checkMobileUpdates();
    await vi.runAllTimersAsync();
    await check;
    expect(native.set).toHaveBeenCalledExactlyOnceWith({ id: "cached" });
  });
  it("checks again on foreground entry even within the normal throttle", async () => {
    native.verify.mockResolvedValue({ version: "1.3.0", files: [] });
    const { startMobileUpdates, checkMobileUpdates } = await import("./mobile-updates");
    await startMobileUpdates();
    await checkMobileUpdates();
    native.listener.mock.calls[0][1]({ isActive: true });
    await checkMobileUpdates();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(native.set).not.toHaveBeenCalled();
  });
  it.each(["offline", "signature", "watchdog"])(
    "keeps the installed version after %s failure",
    async (failure) => {
      if (failure === "offline") vi.mocked(fetch).mockRejectedValue(new Error("offline"));
      if (failure === "signature") native.verify.mockRejectedValue(new Error("signature"));
      if (failure === "watchdog")
        native.list.mockResolvedValue({
          bundles: [{ id: "failed", version: "1.3.1", status: "error" }],
        });
      const { checkMobileUpdates, useMobileUpdateStore } = await import("./mobile-updates");
      await checkMobileUpdates(true);
      expect(useMobileUpdateStore.getState().phase).toBe("offline");
      expect(native.download).not.toHaveBeenCalled();
      expect(native.set).not.toHaveBeenCalled();
    },
  );
  it("leaves the web demo independent of native services", async () => {
    native.platform = "web";
    const { startMobileUpdates, checkMobileUpdates } = await import("./mobile-updates");
    await startMobileUpdates();
    await checkMobileUpdates(true);
    expect(native.ready).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
