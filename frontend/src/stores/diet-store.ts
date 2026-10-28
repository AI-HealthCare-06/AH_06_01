import { create } from "zustand";
import { z } from "zod";
import { cloudEnabled } from "../cloud/client";
import { useCloudStore } from "../cloud/sync";
import { useSessionStore } from "./session-store";
import { appStorageKey } from "../domain/demo-mode";
import { localDate } from "../domain/calendar";
import { canSaveDiet, mealRecordSchema, type MealRecord } from "../domain/diet";

const recordsSchema = z.array(mealRecordSchema).max(200);
export function dietOwner() {
  if (!useSessionStore.getState().active) return null;
  return cloudEnabled ? useCloudStore.getState().userId : "local";
}
const key = (owner: string) => appStorageKey("rexrun-diet-records-v1") + ":" + owner;
function load(owner: string | null): MealRecord[] {
  if (!owner) return [];
  try {
    return recordsSchema.parse(JSON.parse(localStorage.getItem(key(owner)) || "[]"));
  } catch {
    return [];
  }
}
type DietState = {
  owner: string | null;
  records: MealRecord[];
  message: string;
  refresh: () => void;
  save: (record: MealRecord, expectedOwner: string) => boolean;
  remove: (id: string) => void;
};
export const useDietStore = create<DietState>((set, get) => ({
  owner: dietOwner(),
  records: load(dietOwner()),
  message: "",
  refresh: () => {
    const owner = dietOwner();
    set({ owner, records: load(owner), message: "" });
  },
  save: (record, expectedOwner) => {
    const owner = dietOwner(),
      parsed = mealRecordSchema.safeParse(record);
    if (
      !owner ||
      owner !== expectedOwner ||
      owner !== get().owner ||
      !parsed.success ||
      !canSaveDiet(parsed.data.items, record.source, true) ||
      record.date > localDate() ||
      !Number.isFinite(Date.parse(record.date + "T12:00:00")) ||
      new Date(record.date + "T12:00:00").getDate() !== Number(record.date.slice(-2))
    )
      return false;
    if (get().records.some((row) => row.id === record.id)) return false;
    const records = [parsed.data, ...get().records].slice(0, 200);
    try {
      localStorage.setItem(key(owner), JSON.stringify(records));
      set({ records, message: "식단 기록을 이 기기에 저장했어요." });
      return true;
    } catch {
      set({ message: "기기 저장 공간을 확인해 주세요. 기록은 저장되지 않았어요." });
      return false;
    }
  },
  remove: (id) => {
    const owner = dietOwner();
    if (!owner || owner !== get().owner) return;
    const records = get().records.filter((row) => row.id !== id);
    try {
      localStorage.setItem(key(owner), JSON.stringify(records));
      set({ records, message: "기록을 삭제했어요." });
    } catch {
      set({ message: "기기 저장 공간을 확인해 주세요." });
    }
  },
}));
useSessionStore.subscribe(() => useDietStore.getState().refresh());
useCloudStore.subscribe((next, prior) => {
  if (next.userId !== prior.userId) useDietStore.getState().refresh();
});
