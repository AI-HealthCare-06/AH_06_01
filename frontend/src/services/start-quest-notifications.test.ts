import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../cloud/sync", () => ({ useCloudStore: { getState: () => ({ userId: "clock-test" }) } }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
}));
vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn() } }));
vi.mock("./quest-notifications", async (original) => ({
  ...(await original<typeof import("./quest-notifications")>()),
  syncQuestNotifications: vi.fn(async () => undefined),
  cancelQuestNotifications: vi.fn(async () => undefined),
}));
vi.mock("../stores/game-store", async () => {
  const { create } = await import("zustand");
  const { initialGame } = await import("../domain/game");
  return { useGameStore: create(() => ({ game: initialGame() })) };
});
vi.mock("../stores/session-store", async () => {
  const { create } = await import("zustand");
  return { useSessionStore: create(() => ({ active: true })) };
});
import { initialGame } from "../domain/game";
import { useGameStore } from "../stores/game-store";
import { useSessionStore } from "../stores/session-store";
import { useQuestNotificationStore } from "../stores/quest-notification-store";
import { startQuestNotifications } from "./start-quest-notifications";
import { cancelQuestNotifications, syncQuestNotifications } from "./quest-notifications";

describe("quest action driven scheduling", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 5, 10));
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    useSessionStore.setState({ active: true });
    useGameStore.setState({ game: initialGame() });
    useQuestNotificationStore.getState().activate("owner-a");
    useQuestNotificationStore.getState().update("reminders", true);
    vi.clearAllMocks();
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("resets immediately on completed quests, but not step telemetry, edits, or a restarted observer", async () => {
    stop = startQuestNotifications();
    const originalAnchor = useQuestNotificationStore.getState().reminderAnchor;
    await vi.advanceTimersByTimeAsync(60_000);
    useGameStore.setState(({ game }) => ({
      game: {
        ...game,
        steps: { date: game.date, count: 100, source: "health-connect", syncedAt: Date.now() },
      },
    }));
    await vi.advanceTimersByTimeAsync(500);
    expect(useQuestNotificationStore.getState().reminderAnchor).toBe(originalAnchor);
    const completedAt = Date.now();
    useGameStore.setState(({ game }) => ({
      game: { ...game, completed: ["survey"], activity: { survey: 1 } },
    }));
    expect(useQuestNotificationStore.getState().reminderAnchor).toBe(completedAt);
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.mocked(syncQuestNotifications).mock.lastCall?.[2]).toBe(completedAt);
    stop();
    stop = startQuestNotifications();
    expect(useQuestNotificationStore.getState().reminderAnchor).toBe(completedAt);
  });
  it("resets on allowed repeat actions and rejects stale account jobs", async () => {
    stop = startQuestNotifications();
    const ownsAccount = vi.mocked(syncQuestNotifications).mock.calls[0][3]!;
    await vi.advanceTimersByTimeAsync(60_000);
    const completedAt = Date.now();
    useGameStore.setState(({ game }) => ({ game: { ...game, activity: { meal: 2 } } }));
    expect(useQuestNotificationStore.getState().reminderAnchor).toBe(completedAt);
    useQuestNotificationStore.getState().activate("owner-b");
    expect(ownsAccount()).toBe(false);
    const cancellations = vi.mocked(cancelQuestNotifications).mock.calls.length;
    useQuestNotificationStore.setState({ message: "New account status" });
    expect(vi.mocked(cancelQuestNotifications).mock.calls.length).toBe(cancellations);
    const otherAnchor = useQuestNotificationStore.getState().reminderAnchor;
    await vi.advanceTimersByTimeAsync(60_000);
    useGameStore.setState(({ game }) => ({ game: { ...game, completed: ["walk"] } }));
    expect(useQuestNotificationStore.getState().reminderAnchor).toBe(otherAnchor);
  });
});
