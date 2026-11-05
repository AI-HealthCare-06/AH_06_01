import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { useGameStore } from "../stores/game-store";
import { useQuestNotificationStore } from "../stores/quest-notification-store";
import {
  cancelQuestNotifications,
  hasQuestCompletion,
  syncQuestNotifications,
} from "./quest-notifications";
import { useSessionStore } from "../stores/session-store";
export function startQuestNotifications() {
  const owner = useQuestNotificationStore.getState().owner;
  let key = "",
    stopped = false;
  const refresh = () => {
    if (
      stopped ||
      !useSessionStore.getState().active ||
      useQuestNotificationStore.getState().owner !== owner
    )
      return;
    const game = useGameStore.getState().game,
      { preferences, reminderAnchor } = useQuestNotificationStore.getState();
    const current = JSON.stringify([
      game.date,
      game.completed,
      Math.floor((game.steps?.count ?? 0) / 100),
      game.exerciseCoach,
      preferences,
      reminderAnchor,
    ]);
    if (current === key) return;
    key = current;
    void syncQuestNotifications(
      game,
      preferences,
      reminderAnchor ?? Date.now(),
      () =>
        !stopped &&
        useSessionStore.getState().active &&
        useQuestNotificationStore.getState().owner === owner,
    ).catch(() => {
      if (!stopped && useQuestNotificationStore.getState().owner === owner) {
        key = "";
        useQuestNotificationStore.setState({
          message: "기기 알림 설정을 확인해 주세요. 알림 동기화에 실패했어요.",
        });
      }
    });
  };
  let timer: ReturnType<typeof setTimeout>;
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 500);
  };
  const game = useGameStore.subscribe((next, prev) => {
    if (
      stopped ||
      !useSessionStore.getState().active ||
      useQuestNotificationStore.getState().owner !== owner
    )
      return;
    if (hasQuestCompletion(prev.game, next.game))
      useQuestNotificationStore.getState().resetReminderClock();
    if (
      next.game.date !== prev.game.date ||
      next.game.completed !== prev.game.completed ||
      next.game.activity !== prev.game.activity ||
      next.game.profileQuests !== prev.game.profileQuests ||
      next.game.exerciseCoach !== prev.game.exerciseCoach ||
      Math.floor((next.game.steps?.count ?? 0) / 100) !==
        Math.floor((prev.game.steps?.count ?? 0) / 100)
    )
      debounced();
  });
  const settings = useQuestNotificationStore.subscribe((next, prev) => {
    if (next.owner !== owner) {
      clearTimeout(timer);
      if (prev.owner === owner) void cancelQuestNotifications();
    } else if (next.preferences !== prev.preferences || next.reminderAnchor !== prev.reminderAnchor)
      debounced();
  });
  const session = useSessionStore.subscribe((s) => {
    if (!s.active) {
      clearTimeout(timer);
      void cancelQuestNotifications();
    }
  });
  const listener = Capacitor.isNativePlatform()
    ? App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          key = "";
          refresh();
        }
      })
    : null;
  refresh();
  return () => {
    stopped = true;
    clearTimeout(timer);
    game();
    settings();
    session();
    void listener?.then((l) => l.remove());
    void cancelQuestNotifications();
  };
}
