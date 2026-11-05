import { Capacitor } from "@capacitor/core";
import { LocalNotifications, type LocalNotificationSchema } from "@capacitor/local-notifications";
import { mainQuests, mainQuestCount, type GameState } from "../domain/game";
import { localDate } from "../domain/calendar";
export const questNotificationGroup = "rexrun-quest-coach";
export type QuestNotificationPreferences = { reminders: boolean; progress: boolean };
export const progressNotificationId = 80_000;
export const questReminderInterval = 3.5 * 60 * 60 * 1000;

// A successful action resets the timer; sensor ticks, edits and battle rewards do not.
export function hasQuestCompletion(previous: GameState, next: GameState) {
  const sameDay = previous.date === next.date;
  if (next.completed.some((id) => !sameDay || !previous.completed.includes(id))) return true;
  if (
    Object.entries(next.activity).some(
      ([id, count]) =>
        (count ?? 0) >
        (sameDay ? (previous.activity[id as keyof typeof previous.activity] ?? 0) : 0),
    )
  )
    return true;
  if (
    (next.exerciseCoach.completed[next.date] ?? []).some(
      (id) => !previous.exerciseCoach.completed[next.date]?.includes(id),
    )
  )
    return true;
  if (!previous.exerciseCoach.survey && next.exerciseCoach.survey) return true;
  return Object.entries(next.profileQuests.completed).some(
    ([id, receipt]) =>
      receipt &&
      !previous.profileQuests.completed[id as keyof typeof previous.profileQuests.completed],
  );
}
export function questProgressSummary(game: GameState) {
  const today = game.date === localDate();
  const count = today ? mainQuestCount(game.completed) : 0;
  const walk = today ? Math.min(6000, game.steps?.count ?? 0) : 0;
  const exercises = today ? (game.exerciseCoach.completed[game.date]?.length ?? 0) : 0;
  return {
    title: `${game.date.slice(5)} 퀘스트 ${count} / ${mainQuests.length} 완료`,
    body: `건강 서베이 ${today && game.completed.includes("survey") ? "완료" : "대기"} · 식사 ${today && game.completed.includes("meal") ? "완료" : "대기"}\n걷기 ${walk.toLocaleString("ko-KR")} / 6,000보 · 맞춤 운동 ${exercises}개 완료`,
  };
}
export function buildQuestReminders(
  game: GameState,
  now = new Date(),
  reminderAnchor = now.getTime(),
): LocalNotificationSchema[] {
  const reminders: LocalNotificationSchema[] = [];
  const anchor = new Date(
    Number.isSafeInteger(reminderAnchor) && reminderAnchor >= 0 && reminderAnchor <= now.getTime()
      ? reminderAnchor
      : now.getTime(),
  );
  for (let day = 0; day < 7; day++) {
    const morning = new Date(now);
    morning.setDate(morning.getDate() + day);
    morning.setHours(9, 0, 0, 0);
    const end = new Date(morning);
    end.setHours(21, 0, 0, 0);
    const sameDay = localDate(morning) === game.date;
    if (sameDay && mainQuestCount(game.completed) === mainQuests.length) continue;
    const start =
      localDate(anchor) === localDate(morning)
        ? Math.max(morning.getTime(), anchor.getTime() + questReminderInterval)
        : morning.getTime();
    // Daylight slots are derived from the persisted anchor, never from each refresh.
    for (
      let time = start, index = 0;
      time < end.getTime();
      time += questReminderInterval, index++
    ) {
      if (time <= now.getTime()) continue;
      const at = new Date(time);
      reminders.push({
        id: 81_000 + day * 10 + index,
        title: "REXRUN · 잠깐, 나를 위한 퀘스트 시간",
        body: sameDay
          ? `오늘 퀘스트 ${mainQuestCount(game.completed)} / ${mainQuests.length} 완료 · 남은 실천을 확인해 볼까요? 무리하지 않고 하나씩 이어가요.`
          : "오늘의 건강 서베이와 식사·걸음 퀘스트를 확인해 볼까요? 작은 실천을 이어가요.",
        channelId: questNotificationGroup,
        extra: {
          group: questNotificationGroup,
          route: "/quests",
          date: localDate(at),
        },
        schedule: { at, allowWhileIdle: false },
        isExactNotification: false,
      });
    }
  }
  return reminders;
}
let queue: Promise<unknown> = Promise.resolve();
let generation = 0;
function enqueue(task: () => Promise<void>) {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}
async function cancel() {
  const pending = await LocalNotifications.getPending();
  const notifications = pending.notifications
    .filter((n) => n.extra?.group === questNotificationGroup)
    .map((n) => ({ id: n.id }));
  if (notifications.length) await LocalNotifications.cancel({ notifications });
  const delivered = await LocalNotifications.getDeliveredNotifications();
  const own = delivered.notifications.filter((n) => n.extra?.group === questNotificationGroup);
  if (own.length) await LocalNotifications.removeDeliveredNotifications({ notifications: own });
}
export function cancelQuestNotifications() {
  generation++;
  return Capacitor.getPlatform() === "android" ? enqueue(cancel) : Promise.resolve();
}
export async function requestQuestNotificationPermission() {
  if (Capacitor.getPlatform() !== "android")
    throw new Error("기기 알림과 알림창 진행도는 Android 앱에서 켤 수 있어요.");
  if ((await LocalNotifications.requestPermissions()).display !== "granted")
    throw new Error("기기 설정에서 REXRUN 알림을 허용해 주세요.");
}
export function syncQuestNotifications(
  game: GameState,
  preferences: QuestNotificationPreferences,
  reminderAnchor = Date.now(),
  isCurrent = () => true,
) {
  const ticket = ++generation;
  const current = () => ticket === generation && isCurrent();
  if (Capacitor.getPlatform() !== "android") return Promise.resolve();
  return enqueue(async () => {
    if (!current()) return;
    await cancel();
    if (
      !current() ||
      (!preferences.reminders && !preferences.progress) ||
      (await LocalNotifications.checkPermissions()).display !== "granted"
    )
      return;
    await LocalNotifications.createChannel({
      id: questNotificationGroup,
      name: "건강 퀘스트 독려",
      importance: 3,
      visibility: 0,
      vibration: true,
    });
    await LocalNotifications.createChannel({
      id: "rexrun-quest-progress",
      name: "오늘의 퀘스트 진행도",
      importance: 1,
      visibility: 0,
      vibration: false,
    });
    const notifications = preferences.reminders
      ? buildQuestReminders(game, new Date(), reminderAnchor)
      : [];
    if (preferences.progress)
      notifications.push({
        id: progressNotificationId,
        ...questProgressSummary(game),
        channelId: "rexrun-quest-progress",
        ongoing: true,
        autoCancel: false,
        extra: { group: questNotificationGroup, route: "/quests", date: localDate() },
        schedule: { at: new Date(Date.now() + 300) },
      });
    if (current() && notifications.length) await LocalNotifications.schedule({ notifications });
  });
}
