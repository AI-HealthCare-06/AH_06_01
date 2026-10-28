import { appStorageKey } from "../domain/demo-mode";
import { create } from "zustand";
import { bloodPressureEntry } from "../domain/blood-pressure-entry";
import { useSessionStore } from "./session-store";
import { initialProfile } from "../domain/profile";
import type { HealthProfile } from "../domain/profile";
import { localDate } from "../domain/calendar";
import { getProfileAvatar } from "../design/profile-avatars";
const registrationKey = appStorageKey("rexrun-profile-registration-date");
const onboardingKey = appStorageKey("rexrun-onboarding-completed");
const avatarKey = appStorageKey("rexrun-profile-avatar-id");
function readAvatar() {
  try {
    return getProfileAvatar(localStorage.getItem(avatarKey))?.id ?? null;
  } catch {
    return null;
  }
}
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

// This store keeps health inputs in memory; consented, account-scoped persistence lives in cloud/sync.
export const useProfileStore = create<{
  profile: HealthProfile;
  hasProfileInput: boolean;
  hasBloodPressureInput: boolean;
  recordBloodPressure: (systolic: string, diastolic: string) => boolean;
  registeredOn: string | null;
  onboardingCompleted: boolean;
  avatarId: string | null;
  setAvatar: (id: string | null) => void;
  setProfile: (profile: HealthProfile) => void;
  completeOnboarding: () => void;
  clear: (keepOnboarding?: boolean) => void;
}>((set, get) => ({
  profile: initialProfile,
  hasProfileInput: false,
  hasBloodPressureInput: false,
  registeredOn: readRegistration(),
  onboardingCompleted: readOnboarding(),
  avatarId: readAvatar(),
  recordBloodPressure: (systolic, diastolic) => {
    const value = bloodPressureEntry(systolic, diastolic);
    if (!value || !useSessionStore.getState().active) return false;
    set({ profile: { ...get().profile, bloodPressure: value }, hasBloodPressureInput: true });
    return true;
  },
  setAvatar: (id) => {
    if (id !== null && !getProfileAvatar(id)) return;
    try {
      if (id === null) localStorage.removeItem(avatarKey);
      else localStorage.setItem(avatarKey, id);
    } catch {
      /* The choice still works for this session when storage is unavailable. */
    }
    set({ avatarId: id });
  },
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
    set({
      profile,
      registeredOn,
      hasProfileInput: true,
      hasBloodPressureInput: profile.bloodPressure !== null,
    });
  },
  clear: (keepOnboarding = false) => {
    const onboardingCompleted = keepOnboarding && get().onboardingCompleted;
    try {
      localStorage.removeItem(registrationKey);
      localStorage.removeItem(avatarKey);
      if (onboardingCompleted) localStorage.setItem(onboardingKey, "true");
      else localStorage.removeItem(onboardingKey);
    } catch {
      /* Optional metadata. */
    }
    set({
      profile: initialProfile,
      registeredOn: null,
      onboardingCompleted,
      hasProfileInput: false,
      hasBloodPressureInput: false,
      avatarId: null,
    });
  },
}));
