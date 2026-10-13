export function battleNotificationPermission() {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}
export async function requestBattleNotifications() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.requestPermission();
}
export function sendBattleFailureNotification(title: string, body: string) {
  if (battleNotificationPermission() !== "granted") return;
  try {
    new Notification(title, {
      body,
      tag: "rexrun-wave-failure",
      icon: "/assets/figma/theme-dino-footprint-watermark.svg",
    });
  } catch {
    /* In-page notices remain available when system notifications are unsupported. */
  }
}
