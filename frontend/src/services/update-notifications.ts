import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
const seenKey = (native: string, version: string) => `rexrun-update-notified:${native}:${version}`;
export async function notifyUpdateAvailable(native: string, version: string) {
  if (Capacitor.getPlatform() !== "android") return;
  const key = seenKey(native, version);
  try {
    if (localStorage.getItem(key)) return;
  } catch {
    /* Deduplication may be session-only. */
  }
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") return; // Never prompt without a user gesture.
  const delivered = await PushNotifications.getDeliveredNotifications().catch(() => ({
    notifications: [],
  }));
  if (
    delivered.notifications.some(
      (n) => n.data?.kind === "app_update" && n.data?.version === version,
    )
  ) {
    try {
      localStorage.setItem(key, "true");
    } catch {
      /* Optional metadata. */
    }
    return;
  }
  await LocalNotifications.createChannel({
    id: "rexrun-updates",
    name: "앱 업데이트",
    importance: 3,
    visibility: 0,
  });
  const hash = [...version].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 1_000_000, 0);
  await LocalNotifications.schedule({
    notifications: [
      {
        id: 2_100_000_000 + hash,
        title: "REXRUN · 새 업데이트",
        body: `v${version} 업데이트가 준비됐어요.`,
        channelId: "rexrun-updates",
        extra: { group: "rexrun-update", version },
        schedule: { at: new Date(Date.now() + 500) },
      },
    ],
  });
  try {
    localStorage.setItem(key, "true");
  } catch {
    /* Optional metadata. */
  }
}
export async function startUpdateNotificationRouting() {
  await LocalNotifications.createChannel({
    id: "rexrun-updates",
    name: "앱 업데이트",
    importance: 3,
    visibility: 0,
  });
  await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
    if (notification.data?.kind === "app_update") location.assign("/me?updates=1");
  });
}
