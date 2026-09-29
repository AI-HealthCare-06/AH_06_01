import { create } from "zustand";
import { initialProfile } from "../domain/profile";
import type { HealthProfile } from "../domain/profile";
import { localDate } from "../domain/calendar";
const registrationKey = "rexrun-profile-registration-date";
function readRegistration() {
  try {
    const value = localStorage.getItem(registrationKey);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

// Health inputs and login credentials are never persisted by this UI demo.
export const useProfileStore = create<{
  profile: HealthProfile;
  registeredOn: string | null;
  setProfile: (profile: HealthProfile) => void;
  clear: () => void;
}>((set) => ({
  profile: initialProfile,
  registeredOn: readRegistration(),
  setProfile: (profile) => {
    const registeredOn = localDate();
    try {
      localStorage.setItem(registrationKey, registeredOn);
    } catch {
      /* Optional metadata. */
    }
    set({ profile, registeredOn });
  },
  clear: () => {
    try {
      localStorage.removeItem(registrationKey);
    } catch {
      /* Optional metadata. */
    }
    set({ profile: initialProfile, registeredOn: null });
  },
}));
