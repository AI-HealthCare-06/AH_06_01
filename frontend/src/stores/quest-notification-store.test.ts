import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../cloud/sync", () => ({ useCloudStore: { getState: () => ({ userId: "clock-test" }) } }));
import { useQuestNotificationStore } from "./quest-notification-store";

describe("account-owned encouragement clock", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 5, 10));
    useQuestNotificationStore.getState().activate(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("migrates old preferences and restores the saved anchor without postponing it", () => {
    localStorage.setItem("owner-a", JSON.stringify({ reminders: true, progress: false }));
    useQuestNotificationStore.getState().activate("owner-a");
    const anchor = useQuestNotificationStore.getState().reminderAnchor;
    vi.advanceTimersByTime(60_000);
    useQuestNotificationStore.getState().activate("owner-a");
    expect(useQuestNotificationStore.getState().reminderAnchor).toBe(anchor);
    expect(useQuestNotificationStore.getState().preferences.reminders).toBe(true);
  });
  it("resets on completion or enabling reminders, but not when toggling progress", () => {
    const store = useQuestNotificationStore;
    store.getState().activate("owner-a");
    vi.advanceTimersByTime(60_000);
    store.getState().resetReminderClock();
    expect(store.getState().reminderAnchor).toBe(Date.now());
    const completedAt = Date.now();
    vi.advanceTimersByTime(60_000);
    store.getState().update("progress", true);
    expect(store.getState().reminderAnchor).toBe(completedAt);
    store.getState().update("reminders", true);
    expect(store.getState().reminderAnchor).toBe(Date.now());
  });
  it("isolates clocks between accounts and does not save while logged out", () => {
    const store = useQuestNotificationStore;
    store.getState().activate("owner-a");
    const first = store.getState().reminderAnchor;
    vi.advanceTimersByTime(60_000);
    store.getState().activate("owner-b");
    expect(store.getState().reminderAnchor).not.toBe(first);
    store.getState().activate("owner-a");
    expect(store.getState().reminderAnchor).toBe(first);
    store.getState().activate(null);
    store.getState().resetReminderClock();
    expect(store.getState().reminderAnchor).toBeNull();
  });
});
