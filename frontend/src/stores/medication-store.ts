import { appStorageKey, demoMode } from "../domain/demo-mode";
import { create } from "zustand";
import { dailyDoses, doseKey, medicationListSchema, type Medication } from "../domain/medications";
import { localDate } from "../domain/calendar";
import { useGameStore } from "./game-store";
import { useSessionStore } from "./session-store";
import {
  cancelMedicationNotifications,
  requestMedicationNotifications,
  scheduleMedicationNotifications,
} from "../services/medication-notifications";
import { z } from "zod";
import { useQuestVerificationStore } from "./quest-verification-store";

const key = appStorageKey("rexrun-medications-v1");
const schema = z.object({
  medications: medicationListSchema,
  taken: z.record(z.string(), z.boolean()),
  notificationsEnabled: z.boolean(),
});
function load() {
  try {
    return schema.parse(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return { medications: [], taken: {}, notificationsEnabled: false };
  }
}
type MedicationState = ReturnType<typeof load> & {
  message: string;
  busy: boolean;
  saveMedication: (medication: Medication) => boolean;
  replaceMedications: (medications: Medication[]) => void;
  removeMedication: (id: string) => void;
  markTaken: (id: string, time: string) => boolean;
  setNotifications: (enabled: boolean) => Promise<void>;
  syncNotifications: () => Promise<void>;
  restore: (state: ReturnType<typeof load>) => void;
  clear: () => Promise<void>;
};
function persist(state: ReturnType<typeof load>) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        medications: state.medications,
        taken: state.taken,
        notificationsEnabled: state.notificationsEnabled,
      }),
    );
  } catch {
    /* The current session remains usable without storage. */
  }
}
let generation = 0;
export const useMedicationStore = create<MedicationState>((set, get) => ({
  ...load(),
  message: "등록한 복용 시간은 매일 복약 퀘스트에 반영돼요.",
  busy: false,
  restore: (state) => {
    const parsed = schema.safeParse(state);
    if (!parsed.success) return;
    persist(parsed.data);
    set(parsed.data);
  },
  saveMedication: (medication) => {
    const medications = [
      ...get().medications.filter((med) => med.id !== medication.id),
      medication,
    ];
    const parsed = medicationListSchema.safeParse(medications);
    if (!parsed.success) {
      set({ message: parsed.error.issues[0].message });
      return false;
    }
    get().replaceMedications(parsed.data);
    return true;
  },
  replaceMedications: (medications) => {
    const parsed = medicationListSchema.safeParse(medications);
    if (!parsed.success) return;
    const state = { ...get(), medications: parsed.data };
    persist(state);
    set({ medications: parsed.data });
    void get().syncNotifications();
  },
  removeMedication: (id) =>
    get().replaceMedications(get().medications.filter((med) => med.id !== id)),
  markTaken: (id, time) => {
    if (!useSessionStore.getState().active) return false;
    const date = localDate();
    const key = doseKey(date, id, time);
    const doses = dailyDoses(get().medications, date, get().taken);
    const dose = doses.find((item) => item.key === key);
    if (!dose || dose.taken) return false;
    if (!useQuestVerificationStore.getState().consume("medicine", key)) return false;
    const taken = {
      ...Object.fromEntries(Object.entries(get().taken).filter(([key]) => key.startsWith(date))),
      [key]: true,
    };
    const state = { ...get(), taken };
    persist(state);
    set({ taken });
    if (dailyDoses(state.medications, date, taken).every((item) => item.taken))
      useGameStore.getState().complete("medicine");
    return true;
  },
  setNotifications: async (enabled) => {
    if (demoMode) return;
    const token = generation;
    set({ busy: true });
    try {
      if (enabled) await requestMedicationNotifications();
      if (token !== generation || !useSessionStore.getState().active) return;
      persist({ ...get(), notificationsEnabled: enabled });
      set({ notificationsEnabled: enabled });
      await get().syncNotifications();
    } catch (error) {
      if (token === generation)
        set({ message: error instanceof Error ? error.message : "알림을 설정하지 못했어요." });
    } finally {
      if (token === generation) set({ busy: false });
    }
  },
  syncNotifications: async () => {
    if (demoMode) return;
    const token = generation;
    try {
      const message = await scheduleMedicationNotifications(
        get().medications,
        get().notificationsEnabled && useSessionStore.getState().active,
      );
      if (token === generation) set({ message });
    } catch (error) {
      if (token === generation)
        set({ message: error instanceof Error ? error.message : "알림을 설정하지 못했어요." });
    }
  },
  clear: async () => {
    generation++;
    try {
      localStorage.removeItem(key);
    } catch {
      /* Optional storage. */
    }
    set({
      medications: [],
      taken: {},
      notificationsEnabled: false,
      busy: false,
      message: "복용 정보와 예약 알림을 삭제했어요.",
    });
    await cancelMedicationNotifications();
  },
}));
