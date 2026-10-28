import { create } from "zustand";

export const useBattleFeedbackStore = create<{
  status: "clear" | "defeat" | null;
  show: (status: "clear" | "defeat") => void;
  clear: () => void;
}>((set) => ({
  status: null,
  show: (status) => set({ status }),
  clear: () => set({ status: null }),
}));
