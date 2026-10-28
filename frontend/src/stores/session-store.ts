import { appStorageKey } from "../domain/demo-mode";
import { create } from "zustand";
import { cloudEnabled } from "../cloud/client";

const key = appStorageKey("rexrun-demo-session-active");
function isActive() {
  if (cloudEnabled) return false;
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}
// An unconfigured installation can open the demo; an explicit logout stays logged out.
export const useSessionStore = create<{ active: boolean; signIn: () => void; signOut: () => void }>(
  (set) => ({
    active: isActive(),
    signIn: () => {
      try {
        localStorage.setItem(key, "true");
      } catch {
        /* Optional metadata. */
      }
      set({ active: true });
    },
    signOut: () => {
      try {
        localStorage.setItem(key, "false");
      } catch {
        /* Optional metadata. */
      }
      set({ active: false });
    },
  }),
);
