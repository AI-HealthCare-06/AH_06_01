import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  platform: "android",
  permission: "granted",
  delivered: [] as { data: { kind: string; version: string } }[],
  schedule: vi.fn(),
  channel: vi.fn(),
  listener: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => mock.platform } }));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: mock.permission }),
    createChannel: mock.channel,
    schedule: mock.schedule,
  },
}));
vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    getDeliveredNotifications: async () => ({ notifications: mock.delivered }),
    addListener: mock.listener,
  },
}));
import { notifyUpdateAvailable } from "./update-notifications";
beforeEach(() => {
  vi.clearAllMocks();
  mock.platform = "android";
  mock.permission = "granted";
  mock.delivered = [];
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("notifies once per trusted native/web version and links to the update settings", async () => {
  await notifyUpdateAvailable("1.5.0", "1.5.7");
  await notifyUpdateAvailable("1.5.0", "1.5.7");
  expect(mock.schedule).toHaveBeenCalledTimes(1);
  expect(mock.schedule.mock.calls[0][0].notifications[0]).toMatchObject({
    title: "REXRUN · 새 업데이트",
    body: "v1.5.7 업데이트가 준비됐어요.",
    channelId: "rexrun-updates",
    extra: { group: "rexrun-update", version: "1.5.7" },
  });
  await notifyUpdateAvailable("1.5.0", "1.5.8");
  expect(mock.schedule).toHaveBeenCalledTimes(2);
});
it("does not prompt or schedule when permission is denied or on web", async () => {
  mock.permission = "denied";
  await notifyUpdateAvailable("1.5.0", "1.5.7");
  mock.permission = "granted";
  mock.platform = "web";
  await notifyUpdateAvailable("1.5.0", "1.5.7");
  expect(mock.schedule).not.toHaveBeenCalled();
  expect(mock.channel).not.toHaveBeenCalled();
});
it("avoids duplicating an already delivered remote update push", async () => {
  mock.delivered = [{ data: { kind: "app_update", version: "1.5.7" } }];
  await notifyUpdateAvailable("1.5.0", "1.5.7");
  mock.delivered = [];
  await notifyUpdateAvailable("1.5.0", "1.5.7");
  expect(mock.schedule).not.toHaveBeenCalled();
});
