import { create } from "zustand";
import { initialProfile } from "../domain/profile";
import type { HealthProfile } from "../domain/profile";

// Health inputs and login credentials are never persisted by this UI demo.
export const useProfileStore = create<{
  profile: HealthProfile;
  setProfile: (profile: HealthProfile) => void;
  clear: () => void;
}>((set) => ({
  profile: initialProfile,
  setProfile: (profile) => set({ profile }),
  clear: () => set({ profile: initialProfile }),
}));
