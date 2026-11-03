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
} from "./quest-notifications";
import { initialGame } from "../domain/game";
import { localDate } from "../domain/calendar";
describe("daily quest encouragement and notification shade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.permission = true;
    state.platform = "android";
  });
  it("schedules seven days at most four per day, outside quiet hours, without exact alarms", () => {
    const now = new Date("2026-11-03T08:00:00+09:00"),
      list = buildQuestReminders(initialGame("2026-11-03"), now);
    expect(list).toHaveLength(28);
    expect(new Set(list.map((n) => n.id)).size).toBe(28);
    for (const n of list) {
      expect(n.schedule?.at?.getTime()).toBeGreaterThan(now.getTime());
      expect(n.schedule?.at?.getHours()).toBeGreaterThanOrEqual(9);
      expect(n.schedule?.at?.getHours()).toBeLessThan(21);
      expect(n.isExactNotification).toBe(false);
    }
  });
  it("omits today's completed quests without suppressing tomorrow's", () => {
    const game = initialGame("2026-11-03");
    game.completed = ["survey", "meal", "walk", "water"];
    const list = buildQuestReminders(game, new Date("2026-11-03T08:00:00+09:00"));
    expect(list).toHaveLength(24);
    expect(list.every((n) => n.extra.date !== game.date)).toBe(true);
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
});
