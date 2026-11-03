import { Capacitor } from "@capacitor/core";
import { LocalNotifications, type LocalNotificationSchema } from "@capacitor/local-notifications";
import { mainQuests, mainQuestCount, type GameState } from "../domain/game";
import { localDate } from "../domain/calendar";
import { exerciseCatalog } from "../domain/exercise-coach";
export const questNotificationGroup = "rexrun-quest-coach";
export type QuestNotificationPreferences = { reminders: boolean; progress: boolean };
export const progressNotificationId = 80_000;
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
export function buildQuestReminders(game: GameState, now = new Date()): LocalNotificationSchema[] {
  const reminders: LocalNotificationSchema[] = [];
  for (let day = 0; day < 7; day++) {
    const plan = game.exerciseCoach.plan;
    const exercise =
      day === 0 && plan?.date === localDate(now)
        ? plan.items.find((i) => !game.exerciseCoach.completed[plan.date]?.includes(i.id))
        : null;
    const slots = [
      {
        hour: 9,
        minute: 0,
        quest: "survey",
        title: "오늘의 건강 서베이",
        body: "혈압과 어젯밤 수면을 간단히 기록해 볼까요?",
      },
      {
        hour: 12,
        minute: 30,
        quest: "meal",
        title: "건강한 식사하기",
        body: "오늘 식사를 사진으로 남기고 퀘스트를 이어가요.",
      },
      {
        hour: 18,
        minute: 30,
        quest: "walk",
        title: "6,000걸음 걷기",
        body: "무리하지 않는 범위에서 오늘의 걸음 수를 확인해요.",
      },
      {
        hour: 20,
        minute: 30,
        quest: exercise ? "exercise" : "water",
        title: exercise
          ? exerciseCatalog.find((e) => e.id === exercise.id)!.title
          : "선택 서브 퀘스트",
        body: "지금 컨디션이 괜찮다면 짧은 실천 하나로 오늘을 마무리해요. 음주 직후나 몸이 불편한 날은 쉬어요.",
      },
    ];
    for (const [index, slot] of slots.entries()) {
      const at = new Date(now);
      at.setDate(at.getDate() + day);
      at.setHours(slot.hour, slot.minute, 0, 0);
      const sameDay = localDate(at) === game.date;
      if (
        at.getTime() <= now.getTime() ||
        (sameDay && game.completed.includes(slot.quest as (typeof game.completed)[number])) ||
        (sameDay && slot.quest === "water" && game.completed.includes("water"))
      )
        continue;
      reminders.push({
        id: 81_000 + day * 10 + index,
        title: `REXRUN · ${slot.title}`,
        body: slot.body,
        channelId: questNotificationGroup,
        extra: {
          group: questNotificationGroup,
          route:
            slot.quest === "exercise" || slot.quest === "water" ? "/quests?tab=sub" : "/quests",
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
  return Capacitor.getPlatform() === "android" ? enqueue(cancel) : Promise.resolve();
}
export async function requestQuestNotificationPermission() {
  if (Capacitor.getPlatform() !== "android")
    throw new Error("기기 알림과 알림창 진행도는 Android 앱에서 켤 수 있어요.");
  if ((await LocalNotifications.requestPermissions()).display !== "granted")
    throw new Error("기기 설정에서 REXRUN 알림을 허용해 주세요.");
}
export function syncQuestNotifications(game: GameState, preferences: QuestNotificationPreferences) {
  if (Capacitor.getPlatform() !== "android") return Promise.resolve();
  return enqueue(async () => {
    await cancel();
    if (
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
    const notifications = preferences.reminders ? buildQuestReminders(game) : [];
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
    if (notifications.length) await LocalNotifications.schedule({ notifications });
  });
}
