import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { Medication } from "../domain/medications";

export const medicationNotificationGroup = "rexrun-medication";
let queue: Promise<unknown> = Promise.resolve();
// Serialize cancellation and scheduling so rapid edits/logout cannot revive old alarms.
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}
async function cancelRegistered() {
  const pending = await LocalNotifications.getPending();
  const notifications = pending.notifications
    .filter((item) => item.extra?.group === medicationNotificationGroup)
    .map(({ id }) => ({ id }));
  if (notifications.length) await LocalNotifications.cancel({ notifications });
}
export function cancelMedicationNotifications() {
  if (Capacitor.getPlatform() !== "android") return Promise.resolve();
  return enqueue(cancelRegistered);
}
export async function requestMedicationNotifications() {
  if (Capacitor.getPlatform() !== "android")
    throw new Error("복용 시간 알림은 갤럭시 APK에서 켤 수 있어요.");
  if ((await LocalNotifications.requestPermissions()).display !== "granted")
    throw new Error("알림 권한이 꺼져 있어요. 기기 설정에서 REXRUN 알림을 허용해 주세요.");
  if (!(await exactMedicationAlarmAllowed())) await openExactMedicationAlarmSetting();
}
export async function exactMedicationAlarmAllowed() {
  if (Capacitor.getPlatform() !== "android") return false;
  return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === "granted";
}
export async function openExactMedicationAlarmSetting() {
  if (Capacitor.getPlatform() === "android")
    await LocalNotifications.changeExactNotificationSetting();
}
export function scheduleMedicationNotifications(medications: Medication[], enabled: boolean) {
  if (Capacitor.getPlatform() !== "android")
    return Promise.resolve("시간 알림은 갤럭시 APK에서 사용할 수 있어요.");
  return enqueue(async () => {
    await cancelRegistered();
    if (!enabled) return "복용 시간 알림 OFF";
    if ((await LocalNotifications.checkPermissions()).display !== "granted")
      throw new Error("알림 권한이 꺼져 있어요. 복용 알림을 다시 켜 주세요.");
    await LocalNotifications.createChannel({
      id: medicationNotificationGroup,
      name: "복용 시간 알림",
      importance: 4,
      visibility: 0,
      vibration: true,
    });
    const exact = await exactMedicationAlarmAllowed();
    const notifications = medications
      .filter((med) => med.active)
      .flatMap((med) =>
        med.times.map((time) => {
          const [hour, minute] = time.split(":").map(Number);
          return {
            title: "REXRUN · 복용 시간",
            body: "등록한 약의 복용 시간이에요. 복약 퀘스트에서 확인해 주세요.",
            channelId: medicationNotificationGroup,
            isExactNotification: exact,
            extra: { group: medicationNotificationGroup, medicationId: med.id, time },
            schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
          };
        }),
      )
      .map((notification, index) => ({ ...notification, id: 40_000 + index }));
    if (notifications.length) await LocalNotifications.schedule({ notifications });
    return exact
      ? "복용 시간 알림 ON · 매일 등록한 시간에 알려드려요."
      : "알림 ON · 정확한 알람을 허용하지 않으면 알림이 늦을 수 있어요.";
  });
}
