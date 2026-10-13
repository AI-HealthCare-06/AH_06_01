import { create } from "zustand";
import { initialProfile } from "../domain/profile";
import type { HealthProfile } from "../domain/profile";
import { localDate } from "../domain/calendar";
const registrationKey = "rexrun-profile-registration-date";
const onboardingKey = "rexrun-onboarding-completed";
function readRegistration() {
  try {
    const value = localStorage.getItem(registrationKey);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}
function readOnboarding() {
  try {
    const saved = localStorage.getItem(onboardingKey);
    return saved === null ? Boolean(readRegistration()) : saved === "true";
  } catch {
    return false;
  }
}

// Health inputs and login credentials are never persisted by this UI demo.
export const useProfileStore = create<{
  profile: HealthProfile;
  registeredOn: string | null;
  onboardingCompleted: boolean;
  setProfile: (profile: HealthProfile) => void;
  completeOnboarding: () => void;
  clear: (keepOnboarding?: boolean) => void;
}>((set, get) => ({
  profile: initialProfile,
  registeredOn: readRegistration(),
  onboardingCompleted: readOnboarding(),
  completeOnboarding: () => {
    try {
      localStorage.setItem(onboardingKey, "true");
    } catch {
      /* Optional metadata. */
    }
    set({ onboardingCompleted: true });
  },
  setProfile: (profile) => {
    const registeredOn = get().registeredOn ?? localDate();
    try {
      localStorage.setItem(registrationKey, registeredOn);
      localStorage.setItem(onboardingKey, String(get().onboardingCompleted));
    } catch {
      /* Optional metadata. */
    }
    set({ profile, registeredOn });
  },
  clear: (keepOnboarding = false) => {
    const onboardingCompleted = keepOnboarding && get().onboardingCompleted;
    try {
      localStorage.removeItem(registrationKey);
      if (onboardingCompleted) localStorage.setItem(onboardingKey, "true");
      else localStorage.removeItem(onboardingKey);
    } catch {
      /* Optional metadata. */
    }
    set({ profile: initialProfile, registeredOn: null, onboardingCompleted });
  },
}));
