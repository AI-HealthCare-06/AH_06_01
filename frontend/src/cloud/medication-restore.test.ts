import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "../domain/game";
import type { Session } from "@supabase/supabase-js";

const state = vi.hoisted(() => ({
  session: null as Session | null,
  change: (_event: string, _session: Session | null) => {},
  active: false,
  onboarding: false,
  game: {} as Record<string, unknown>,
  remote: {} as Record<string, unknown>,
  schedule: vi.fn(async () => "Scheduled"),
  cancel: vi.fn(async () => {}),
}));
vi.mock("./client", () => ({
  cloudEnabled: true,
  cloudApi: vi.fn(async () => state.remote),
  ApiError: class extends Error {},
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: (callback: typeof state.change) => {
        state.change = callback;
      },
    },
  },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "android", isNativePlatform: () => false },
}));
vi.mock("../stores/session-store", () => ({
  useSessionStore: {
    getState: () => ({
      active: state.active,
      signIn: () => {
        state.active = true;
      },
      signOut: () => {
        state.active = false;
        state.onboarding = false;
      },
    }),
  },
}));
vi.mock("../stores/game-store", async () => {
  const { startProfileQuests } = await import("../domain/profile-quests");
  return {
    useGameStore: {
      getState: () => ({
        game: state.game,
        suspendSession: vi.fn(),
        tick: vi.fn(),
        startProfileQuests: (now = Date.now(), legacy = false) => {
          state.game = startProfileQuests(
            state.game as unknown as GameState,
            now,
            legacy,
          ) as unknown as Record<string, unknown>;
        },
      }),
      setState: (value: { game: Record<string, unknown> }) => {
        state.game = value.game;
      },
      subscribe: vi.fn(),
    },
  };
});
vi.mock("../stores/profile-store", () => ({
  useProfileStore: {
    getState: () => ({
      clear: () => {
        state.onboarding = false;
      },
      onboardingCompleted: state.onboarding,
      setProfile: vi.fn(),
      setAvatar: vi.fn(),
      completeOnboarding: () => {
        state.onboarding = true;
      },
    }),
    subscribe: vi.fn(),
  },
}));
vi.mock("../stores/quest-verification-store", () => ({
  useQuestVerificationStore: { getState: () => ({ consume: () => false }) },
}));
vi.mock("../services/medication-notifications", () => ({
  cancelMedicationNotifications: state.cancel,
  requestMedicationNotifications: vi.fn(async () => {}),
  scheduleMedicationNotifications: state.schedule,
}));

const medication = {
  id: "account-a-medication",
  name: "Synthetic medication",
  dose: "",
  condition: "",
  drugClass: "other",
  times: ["08:00"],
  active: true,
};
const taken = { "2026-10-22|account-a-medication|08:00": true };
const session = (id: string) => ({ user: { id, email: `${id}@example.test` } }) as Session;

describe("account hydration preserves medication reminders", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    state.active = false;
    const entries = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    });
    vi.stubGlobal("window", { setInterval: vi.fn(), addEventListener: vi.fn() });
    vi.stubGlobal("document", { addEventListener: vi.fn() });
    vi.stubGlobal("navigator", { onLine: false });
    const { initialGame } = await import("../domain/game");
    state.game = initialGame() as unknown as Record<string, unknown>;
    state.session = session("account-a");
    state.remote = {
      profile: null,
      health_profile: null,
      medications: [medication],
      taken,
      game: { revision: 3, snapshot: state.game },
    };
    localStorage.setItem(
      "rexrun-medications-v1",
      JSON.stringify({ medications: [medication], taken, notificationsEnabled: true }),
    );
    localStorage.setItem(
      "rexrun-cloud-v1:account-a",
      JSON.stringify({
        revision: 3,
        consent: false,
        queue: [],
        lastAck: null,
        cache: { game: state.game, medications: [medication], taken, avatar_id: null },
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function start() {
    const cloud = await import("./sync");
    cloud.startCloud();
    await vi.waitFor(() => expect(cloud.useCloudStore.getState().ready).toBe(true));
    const { useMedicationStore } = await import("../stores/medication-store");
    return { cloud, medications: useMedicationStore };
  }

  it("migrates a matching legacy preference, persists doses and restores alarms after reload", async () => {
    let app = await start();
    expect(app.medications.getState().notificationsEnabled).toBe(true);
    expect(JSON.parse(localStorage.getItem("rexrun-medications-v1")!).taken).toEqual(taken);
    expect(
      JSON.parse(localStorage.getItem("rexrun-cloud-v1:account-a")!).medicationNotificationsEnabled,
    ).toBe(true);
    expect(state.schedule).toHaveBeenLastCalledWith([medication], true);
    vi.resetModules();
    app = await start();
    expect(app.medications.getState().notificationsEnabled).toBe(true);
    expect(app.medications.getState().taken).toEqual(taken);
    expect(state.schedule).toHaveBeenLastCalledWith([medication], true);
  });

  it("preserves an explicit OFF choice and never inherits another account's alarms", async () => {
    const app = await start();
    await app.medications.getState().setNotifications(false);
    expect(
      JSON.parse(localStorage.getItem("rexrun-cloud-v1:account-a")!).medicationNotificationsEnabled,
    ).toBe(false);
    state.remote = { ...state.remote, medications: [], taken: {} };
    state.change("SIGNED_IN", session("account-b"));
    await vi.waitFor(() => expect(app.cloud.useCloudStore.getState().userId).toBe("account-b"));
    await vi.waitFor(() => expect(app.cloud.useCloudStore.getState().ready).toBe(true));
    expect(app.medications.getState().notificationsEnabled).toBe(false);
    expect(app.medications.getState().medications).toEqual([]);
    state.change("SIGNED_OUT", null);
    await vi.waitFor(() => expect(app.cloud.useCloudStore.getState().userId).toBe(null));
    expect(state.cancel).toHaveBeenCalled();
  });

  it("does not migrate legacy reminders when the cached medication owner does not match", async () => {
    const saved = JSON.parse(localStorage.getItem("rexrun-cloud-v1:account-a")!);
    saved.cache.medications = [{ ...medication, id: "different-owner" }];
    localStorage.setItem("rexrun-cloud-v1:account-a", JSON.stringify(saved));
    const app = await start();
    expect(app.medications.getState().notificationsEnabled).toBe(false);
    expect(state.schedule).toHaveBeenLastCalledWith([medication], false);
  });
  it("preserves first-login deadlines and completion receipts across reloads and account changes", async () => {
    const { initialGame } = await import("../domain/game");
    const { completeProfileQuest } = await import("../domain/profile-quests");
    const first = Date.now() - 2 * 86400000;
    const cached = JSON.parse(localStorage.getItem("rexrun-cloud-v1:account-a")!);
    cached.firstLoginAt = first;
    localStorage.setItem("rexrun-cloud-v1:account-a", JSON.stringify(cached));
    let app = await start();
    expect((state.game as unknown as GameState).profileQuests.startedAt).toBe(first);
    const completed = completeProfileQuest(
      state.game as unknown as GameState,
      "conditions",
      first + 1000,
    );
    state.remote = {
      ...state.remote,
      game: { revision: 4, snapshot: JSON.parse(JSON.stringify(completed)) },
    };
    vi.resetModules();
    app = await start();
    expect((state.game as unknown as GameState).profileQuests).toEqual(completed.profileQuests);
    state.remote = {
      ...state.remote,
      profile: null,
      medications: [],
      taken: {},
      game: { revision: 0, snapshot: initialGame() },
    };
    localStorage.setItem(
      "rexrun-cloud-v1:account-b",
      JSON.stringify({
        revision: 0,
        consent: false,
        queue: [],
        lastAck: null,
        firstLoginAt: first + 86400000,
      }),
    );
    state.change("SIGNED_IN", session("account-b"));
    await vi.waitFor(() =>
      expect(
        app.cloud.useCloudStore.getState().ready &&
          app.cloud.useCloudStore.getState().userId === "account-b",
      ).toBe(true),
    );
    expect((state.game as unknown as GameState).profileQuests).toEqual({
      startedAt: first + 86400000,
      completed: {},
    });
    expect(JSON.parse(localStorage.getItem("rexrun-cloud-v1:account-a")!).firstLoginAt).toBe(first);
  });
  it("migrates a previously completed full onboarding without awarding retrospective EXP", async () => {
    state.remote = { ...state.remote, profile: { onboarding_completed: true, avatar_id: null } };
    await start();
    const game = state.game as unknown as GameState;
    expect(game.experience).toBe(0);
    expect(game.profileQuests.completed.conditions?.experience).toBe(0);
    expect(game.profileQuests.completed.lifestyle?.experience).toBe(0);
  });
});
