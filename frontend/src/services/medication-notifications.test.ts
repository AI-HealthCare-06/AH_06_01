import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  platform: "android",
  granted: true,
  exact: true,
  pending: [] as Array<{ id: number; extra: { group: string } }>,
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => native.platform } }));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    requestPermissions: vi.fn(async () => ({ display: native.granted ? "granted" : "denied" })),
    checkPermissions: vi.fn(async () => ({ display: native.granted ? "granted" : "denied" })),
    checkExactNotificationSetting: vi.fn(async () => ({
      exact_alarm: native.exact ? "granted" : "denied",
    })),
    changeExactNotificationSetting: vi.fn(async () => undefined),
    getPending: vi.fn(async () => ({ notifications: native.pending })),
    cancel: vi.fn(async () => undefined),
    createChannel: vi.fn(async () => undefined),
    schedule: vi.fn(async () => undefined),
  },
}));
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  cancelMedicationNotifications,
  requestMedicationNotifications,
  scheduleMedicationNotifications,
} from "./medication-notifications";
import { medicationSchema } from "../domain/medications";
const medication = medicationSchema.parse({
  id: "a",
  name: "비공개 약 이름",
  times: ["08:00", "20:00"],
});
describe("Android scheduled medication reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.platform = "android";
    native.granted = true;
    native.exact = true;
    native.pending = [
      { id: 40000, extra: { group: "rexrun-medication" } },
      { id: 3, extra: { group: "other" } },
    ];
  });
  it("replaces only medication alarms, schedules every daily time and hides drug details", async () => {
    await scheduleMedicationNotifications([medication], true);
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 40000 }] });
    const notifications = vi.mocked(LocalNotifications.schedule).mock.calls[0][0].notifications;
    expect(notifications.map((item) => item.schedule?.on)).toEqual([
      { hour: 8, minute: 0 },
      { hour: 20, minute: 0 },
    ]);
    expect(
      notifications.every((item) => item.schedule?.repeats && item.schedule.allowWhileIdle),
    ).toBe(true);
    expect(notifications.some((item) => item.body.includes(medication.name))).toBe(false);
  });
  it("does not repeatedly prompt for exact alarms when the user declined", async () => {
    native.exact = false;
    expect(await scheduleMedicationNotifications([medication], true)).toContain("늦을");
    expect(LocalNotifications.changeExactNotificationSetting).not.toHaveBeenCalled();
    expect(
      vi.mocked(LocalNotifications.schedule).mock.calls[0][0].notifications[0].isExactNotification,
    ).toBe(false);
  });
  it("does not schedule without permission and cancels on OFF/logout", async () => {
    native.granted = false;
    await expect(requestMedicationNotifications()).rejects.toThrow("권한");
    await expect(scheduleMedicationNotifications([medication], true)).rejects.toThrow("권한");
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    await scheduleMedicationNotifications([medication], false);
    await cancelMedicationNotifications();
    expect(LocalNotifications.cancel).toHaveBeenCalled();
  });
  it("keeps native permission APIs out of web previews", async () => {
    native.platform = "web";
    await scheduleMedicationNotifications([medication], true);
    expect(LocalNotifications.checkPermissions).not.toHaveBeenCalled();
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
  });
});
