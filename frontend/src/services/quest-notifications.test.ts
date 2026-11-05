import { beforeEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ permission: true, platform: "android" }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => state.platform } }));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    getPending: vi.fn(async () => ({
      notifications: [
        { id: 81000, extra: { group: "rexrun-quest-coach" } },
        { id: 40000, extra: { group: "rexrun-medication" } },
      ],
    })),
    getDeliveredNotifications: vi.fn(async () => ({
      notifications: [{ id: 80000, extra: { group: "rexrun-quest-coach" } }],
    })),
    removeDeliveredNotifications: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    createChannel: vi.fn(async () => undefined),
    schedule: vi.fn(async () => undefined),
    checkPermissions: vi.fn(async () => ({ display: state.permission ? "granted" : "denied" })),
    requestPermissions: vi.fn(async () => ({ display: state.permission ? "granted" : "denied" })),
  },
}));
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  buildQuestReminders,
  syncQuestNotifications,
  cancelQuestNotifications,
  questProgressSummary,
  questReminderInterval,
  hasQuestCompletion,
} from "./quest-notifications";
import { initialGame } from "../domain/game";
import { localDate } from "../domain/calendar";
describe("daily quest encouragement and notification shade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.permission = true;
    state.platform = "android";
  });
  it("waits 3.5 hours then repeats in daylight for seven days without exact alarms", () => {
    const now = new Date("2026-11-03T08:00:00+09:00"),
      list = buildQuestReminders(initialGame("2026-11-03"), now);
    expect(list).toHaveLength(27);
    expect(list[0].schedule?.at?.getTime()).toBe(now.getTime() + questReminderInterval);
    expect(list[1].schedule?.at?.getTime()).toBe(now.getTime() + 2 * questReminderInterval);
    expect(new Set(list.map((n) => n.id)).size).toBe(list.length);
    for (const n of list) {
      expect(n.schedule?.at?.getTime()).toBeGreaterThan(now.getTime());
      expect(n.schedule?.at?.getHours()).toBeGreaterThanOrEqual(9);
      expect(n.schedule?.at?.getHours()).toBeLessThan(21);
      expect(n.isExactNotification).toBe(false);
    }
  });
  it("stops today's encouragement when all mains are complete without suppressing tomorrow", () => {
    const game = initialGame("2026-11-03");
    game.completed = ["survey", "meal", "walk", "medicine"];
    const list = buildQuestReminders(game, new Date("2026-11-03T08:00:00+09:00"));
    expect(list).toHaveLength(24);
    expect(list.every((n) => n.extra.date !== game.date)).toBe(true);
  });
  it("preserves the countdown across refreshes and skips elapsed reminders", () => {
    const now = new Date(2026, 10, 5, 10),
      game = initialGame(localDate(now)),
      anchor = now.getTime();
    const first = buildQuestReminders(game, now, anchor)[0].schedule!.at!.getTime();
    expect(
      buildQuestReminders(game, new Date(anchor + 100_000), anchor)[0].schedule!.at!.getTime(),
    ).toBe(first);
    expect(
      buildQuestReminders(game, new Date(first + 1000), anchor)[0].schedule!.at!.getTime(),
    ).toBe(first + questReminderInterval);
    const completedAt = anchor + 2 * 60 * 60 * 1000;
    expect(
      buildQuestReminders(game, new Date(completedAt), completedAt)[0].schedule!.at!.getTime(),
    ).toBe(completedAt + questReminderInterval);
  });
  it("defers overnight to 9am and restores daylight reminders after a day boundary", () => {
    const now = new Date(2026, 10, 5, 20),
      game = initialGame(localDate(now));
    expect(buildQuestReminders(game, now)[0].schedule!.at).toEqual(new Date(2026, 10, 6, 9));
    const tomorrow = new Date(2026, 10, 6, 8);
    expect(buildQuestReminders(game, tomorrow, now.getTime())[0].schedule!.at).toEqual(
      new Date(2026, 10, 6, 9),
    );
  });
  it("detects main, repeated, first-week and exercise completions but ignores telemetry and edits", () => {
    const previous = initialGame("2026-11-05");
    expect(hasQuestCompletion(previous, { ...previous, completed: ["survey"] })).toBe(true);
    expect(hasQuestCompletion(previous, { ...previous, activity: { water: 2 } })).toBe(true);
    expect(
      hasQuestCompletion(previous, {
        ...previous,
        profileQuests: {
          startedAt: 1,
          completed: { lifestyle: { completedAt: 2, experience: 200 } },
        },
      }),
    ).toBe(true);
    expect(
      hasQuestCompletion(previous, {
        ...previous,
        exerciseCoach: {
          ...previous.exerciseCoach,
          completed: { [previous.date]: ["desk-release"] },
        },
      }),
    ).toBe(true);
    expect(
      hasQuestCompletion(previous, { ...previous, gold: 5000, experience: 40, healthHistory: {} }),
    ).toBe(false);
    const done = { ...previous, completed: ["survey"] as typeof previous.completed };
    expect(hasQuestCompletion(done, { ...done, completed: [...done.completed] })).toBe(false);
    expect(hasQuestCompletion(done, initialGame("2026-11-06"))).toBe(false);
  });
  it("replaces only owned alarms and shows current progress without health/drug identifiers", async () => {
    const game = initialGame(localDate());
    game.completed = ["survey", "meal"];
    game.steps = { date: game.date, count: 4200, source: "health-connect", syncedAt: Date.now() };
    await syncQuestNotifications(game, { reminders: false, progress: true });
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 81000 }] });
    const notification = vi.mocked(LocalNotifications.schedule).mock.calls[0][0].notifications[0];
    expect(notification.title).toContain("2 / 4");
    expect(notification.body).toContain("4,200");
    expect(notification.ongoing).toBe(true);
    expect(questProgressSummary(game).body).not.toMatch(/이시연|혈압|고혈압/);
  });
  it("clears alarms when disabled/logout and never prompts automatically", async () => {
    await syncQuestNotifications(initialGame(), { reminders: false, progress: false });
    await cancelQuestNotifications();
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    expect(LocalNotifications.requestPermissions).not.toHaveBeenCalled();
    expect(LocalNotifications.removeDeliveredNotifications).toHaveBeenCalled();
  });
  it("does not post after permission revocation", async () => {
    state.permission = false;
    await syncQuestNotifications(initialGame(), { reminders: true, progress: true });
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
  });
  it("invalidates queued schedules on logout or a newer account and preserves medication alarms", async () => {
    const pending = syncQuestNotifications(initialGame(), { reminders: true, progress: true });
    await cancelQuestNotifications();
    await pending;
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    await syncQuestNotifications(
      initialGame(),
      { reminders: true, progress: true },
      Date.now(),
      () => false,
    );
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 81000 }] });
  });
});
