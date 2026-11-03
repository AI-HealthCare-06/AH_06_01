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
  activate: (owner: string | null) => void;
  update: (key: keyof QuestNotificationPreferences, enabled: boolean) => void;
}>((set, get) => ({
  preferences: disabled,
  message: "",
  owner: null,
  activate: (owner) => {
    let preferences = disabled;
    try {
      const value = JSON.parse(owner ? (localStorage.getItem(owner) ?? "null") : "null");
      if (value)
        preferences = { reminders: value.reminders === true, progress: value.progress === true };
    } catch {
      /* Invalid preferences stay off. */
    }
    set({ owner, preferences, message: "" });
  },
  update: (key, enabled) => {
    const owner = get().owner;
    if (!owner) return;
    const preferences = { ...get().preferences, [key]: enabled };
    try {
      localStorage.setItem(owner, JSON.stringify(preferences));
      set({ preferences, message: "" });
    } catch {
      set({ message: "설정을 저장하지 못했어요. 기기 저장 공간을 확인해 주세요." });
    }
  },
}));
