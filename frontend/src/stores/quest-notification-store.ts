import { create } from "zustand";
import { appStorageKey, demoMode } from "../domain/demo-mode";
import type { QuestNotificationPreferences } from "../services/quest-notifications";
import { useCloudStore } from "../cloud/sync";
const disabled: QuestNotificationPreferences = { reminders: false, progress: false };
export function questNotificationOwner() {
  return (
    appStorageKey("quest-notifications:") +
    (demoMode ? "demo" : (useCloudStore.getState().userId ?? "local"))
  );
}
export const useQuestNotificationStore = create<{
  preferences: QuestNotificationPreferences;
  message: string;
  owner: string | null;
  reminderAnchor: number | null;
  resetReminderClock: (at?: number) => void;
  activate: (owner: string | null) => void;
  update: (key: keyof QuestNotificationPreferences, enabled: boolean) => void;
}>((set, get) => ({
  preferences: disabled,
  message: "",
  owner: null,
  reminderAnchor: null,
  activate: (owner) => {
    let preferences = disabled;
    let reminderAnchor = Date.now();
    try {
      const value = JSON.parse(owner ? (localStorage.getItem(owner) ?? "null") : "null");
      if (value)
        preferences = { reminders: value.reminders === true, progress: value.progress === true };
      if (Number.isSafeInteger(value?.reminderAnchor) && value.reminderAnchor >= 0)
        reminderAnchor = Math.min(value.reminderAnchor, Date.now());
      if (owner) localStorage.setItem(owner, JSON.stringify({ ...preferences, reminderAnchor }));
    } catch {
      /* Invalid preferences stay off. */
    }
    set({ owner, preferences, reminderAnchor: owner ? reminderAnchor : null, message: "" });
  },
  resetReminderClock: (at = Date.now()) => {
    const { owner, preferences } = get();
    if (!owner || !Number.isSafeInteger(at) || at < 0) return;
    const reminderAnchor = Math.min(at, Date.now());
    try {
      localStorage.setItem(owner, JSON.stringify({ ...preferences, reminderAnchor }));
      set({ reminderAnchor, message: "" });
    } catch {
      set({
        reminderAnchor,
        message: "알림 기준 시각을 저장하지 못했어요. 기기 저장 공간을 확인해 주세요.",
      });
    }
  },
  update: (key, enabled) => {
    const owner = get().owner;
    if (!owner) return;
    const preferences = { ...get().preferences, [key]: enabled };
    const reminderAnchor =
      key === "reminders" && enabled && !get().preferences.reminders
        ? Date.now()
        : (get().reminderAnchor ?? Date.now());
    try {
      localStorage.setItem(owner, JSON.stringify({ ...preferences, reminderAnchor }));
      set({ preferences, reminderAnchor, message: "" });
    } catch {
      set({ message: "설정을 저장하지 못했어요. 기기 저장 공간을 확인해 주세요." });
    }
  },
}));
