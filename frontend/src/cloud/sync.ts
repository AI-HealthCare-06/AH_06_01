import nativeConfig from "../../mobile-updates.config.json";
import { create } from "zustand";
import { setDailySurveyAccount, readDailySurveyGame } from "../services/daily-survey-cache";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import type { Session } from "@supabase/supabase-js";
import { cloudApi, cloudEnabled, supabase, ApiError } from "./client";
import { healthSnapshotKey } from "../domain/bp-stage";
import { createCallbackHandler } from "./oauth-callback";
import { useSessionStore } from "../stores/session-store";
import { useGameStore } from "../stores/game-store";
import { useProfileStore } from "../stores/profile-store";
import { useMedicationStore } from "../stores/medication-store";
import { initialGame, restoreGame, type GameState } from "../domain/game";
import { profileSchema, type HealthProfile } from "../domain/profile";
import { medicationListSchema, type Medication } from "../domain/medications";

type Batch = {
  batch_id: string;
  device_id: string;
  base_revision: number;
  consent_version: string;
  platform: string;
  app_version: string;
  game: GameState;
  profile?: HealthProfile;
  medications: Medication[];
  taken: Record<string, boolean>;
  avatar_id: string | null;
  onboarding_completed: boolean;
};
type Saved = {
  firstLoginAt?: number;
  revision: number;
  consent: boolean;
  queue: Batch[];
  lastAck: string | null;
  cache?: Batch;
  // Device-local preference, scoped to this account; never sent in a sync batch.
  medicationNotificationsEnabled?: boolean;
};
type Remote = {
  profile: { avatar_id: string | null; display_name: string; onboarding_completed: boolean } | null;
  health_profile: {
    age: number;
    sex: string;
    height_cm: number;
    weight_kg: number;
    onboarding_bp_text: string | null;
    fasting_glucose: number | null;
    details: Record<string, unknown>;
  } | null;
  game: { revision: number; snapshot: GameState } | null;
  medications: Array<Medication & { drug_class: string }>;
  taken: Record<string, boolean>;
};
export const useCloudStore = create<{
  ready: boolean;
  userId: string | null;
  email: string | null;
  message: string;
  pending: number;
  consent: boolean;
  lastAck: string | null;
  pushMessage: string;
  healthSnapshotKey: string | null;
  healthSyncPending: boolean;
}>()(() => ({
  ready: !cloudEnabled,
  userId: null,
  email: null,
  message: "서버 연결 준비 중",
  pending: 0,
  consent: false,
  lastAck: null,
  pushMessage: "퀘스트 푸시 알림 꺼짐",
  healthSnapshotKey: null,
  healthSyncPending: false,
}));
let owner: string | null = null,
  saved: Saved = { revision: 0, consent: false, queue: [], lastAck: null };
let hydrating = true,
  generation = 0,
  sending = false,
  started = false;
let deviceId = "";
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 1000;
const key = (uid: string) => `rexrun-cloud-v1:${uid}`;
const legacyMedicationPreference = useMedicationStore.getState();
function publish(message?: string) {
  useCloudStore.setState({
    pending: saved.queue.length,
    consent: saved.consent,
    lastAck: saved.lastAck,
    healthSyncPending: saved.queue.some(
      (batch) =>
        healthSnapshotKey(batch.profile, batch.medications, batch.game) !==
        useCloudStore.getState().healthSnapshotKey,
    ),
    ...(message ? { message } : {}),
  });
}
function persist() {
  if (!owner) return;
  try {
    localStorage.setItem(key(owner), JSON.stringify(saved));
    publish();
  } catch {
    publish("기기 저장 공간이 부족해요. 앱을 닫기 전에 서버 저장 상태를 확인해 주세요.");
    throw new Error("LOCAL_STORAGE_FULL");
  }
}
export function cloudConsent(granted: boolean) {
  saved.consent = granted;
  persist();
  if (granted) {
    capture();
    void flushCloud();
  }
}
export function capture(game = useGameStore.getState().game) {
  if (!cloudEnabled || !owner || hydrating || !saved.consent || !useSessionStore.getState().active)
    return;
  const p = useProfileStore.getState(),
    m = useMedicationStore.getState();
  saved.medicationNotificationsEnabled = m.notificationsEnabled;
  const batch: Batch = {
    batch_id: crypto.randomUUID(),
    device_id: deviceId,
    base_revision: saved.revision + saved.queue.length,
    consent_version: "health-cloud-v1",
    platform: Capacitor.getPlatform(),
    app_version: Capacitor.isNativePlatform()
      ? nativeConfig.nativeVersion
      : import.meta.env.VITE_REXRUN_WEB_VERSION || "development",
    game: JSON.parse(JSON.stringify(game, (k, v) => (k === "debugBuffs" ? undefined : v))),
    ...(p.hasProfileInput ? { profile: p.profile } : {}),
    medications: m.medications,
    taken: m.taken,
    avatar_id: p.avatarId,
    onboarding_completed: p.onboardingCompleted,
  };
  saved.cache = batch;
  saved.queue.push(batch);
  persist();
  publish(
    navigator.onLine ? "서버 저장 대기" : "오프라인 · 이 기기에 저장하고 재연결 후 전송해요.",
  );
}
function hydrate(batch: Batch) {
  const game = restoreGame(batch.game);
  useGameStore.setState({ game, paused: game.battlePaused });
  if (batch.profile) useProfileStore.getState().setProfile(batch.profile);
  useProfileStore.getState().setAvatar(batch.avatar_id);
  if (batch.onboarding_completed) useProfileStore.getState().completeOnboarding();
  useMedicationStore.getState().restore({
    medications: batch.medications,
    taken: batch.taken,
    notificationsEnabled: saved.medicationNotificationsEnabled === true,
  });
}
export async function flushCloud() {
  if (sending || !owner || hydrating || !saved.consent || !navigator.onLine) return;
  const epoch = generation;
  sending = true;
  try {
    while (saved.queue.length && epoch === generation) {
      const head = saved.queue[0];
      const ack = await cloudApi<{
        stored: boolean;
        batch_id: string;
        revision: number;
        received_at: string;
      }>("/v1/sync", head, owner);
      if (epoch !== generation) return;
      if (!ack.stored || ack.batch_id !== head.batch_id) throw new Error("INVALID_ACK");
      saved.revision = ack.revision;
      saved.lastAck = ack.received_at;
      useCloudStore.setState({
        healthSnapshotKey: healthSnapshotKey(head.profile, head.medications, head.game),
      });
      saved.queue.shift();
      persist();
    }
    if (epoch === generation) {
      retryDelay = 1000;
      publish(saved.lastAck ? "서버·DB 저장 확인 완료" : "서버 저장 대기");
      void cloudApi("/v1/notifications/dispatch", {}, owner).catch(() => {
        useCloudStore.setState({
          pushMessage: "기록은 저장됐어요. 푸시 발송은 재시도 대기 중이에요.",
        });
      });
    }
  } catch (e) {
    if (epoch === generation) {
      publish(
        e instanceof ApiError && e.status === 409
          ? "다른 기기에서 변경된 기록이 있어요. 대기 기록을 보존했어요. 계정 동기화 확인이 필요해요."
          : e instanceof ApiError && e.status === 401
            ? "로그인이 만료됐어요. 대기 기록은 기기에 보관돼요."
            : "서버 저장 재시도 대기 · 기록은 이 기기에 보관돼요.",
      );
      if (!(e instanceof ApiError && [401, 403, 409].includes(e.status))) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void flushCloud(), retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    }
  } finally {
    sending = false;
    if (epoch !== generation && owner && !hydrating && saved.queue.length) void flushCloud();
  }
}
async function attach(session: Session | null) {
  if (session && session.user.id === owner) return;
  const previousOwner = owner;
  generation++;
  clearTimeout(retryTimer);
  retryDelay = 1000;
  const attachEpoch = generation;
  hydrating = true;
  owner = null;
  setDailySurveyAccount(null);
  useSessionStore.getState().signOut();
  useCloudStore.setState({ healthSnapshotKey: null, healthSyncPending: false });
  useGameStore.getState().suspendSession();
  useProfileStore.getState().clear();
  await useMedicationStore.getState().clear();
  if (attachEpoch !== generation) return;
  useGameStore.setState({ game: { ...initialGame(), battlePaused: true }, paused: true });
  if (!session) {
    saved = { revision: 0, consent: false, queue: [], lastAck: null };
    useCloudStore.setState({
      ready: true,
      userId: null,
      email: null,
      pending: 0,
      consent: false,
      lastAck: null,
      message: "로그인하면 기록을 서버에 저장해요.",
    });
    return;
  }
  owner = session.user.id;
  setDailySurveyAccount(owner);
  const epoch = generation;
  try {
    saved = JSON.parse(localStorage.getItem(key(owner)) ?? "null") ?? {
      revision: 0,
      consent: false,
      queue: [],
      lastAck: null,
    };
  } catch {
    saved = { revision: 0, consent: false, queue: [], lastAck: null };
  }
  // Migrate the legacy device preference only when its medication IDs match this
  // account's existing cache. Never carry another signed-in account's choice over.
  if (
    saved.medicationNotificationsEnabled === undefined &&
    !previousOwner &&
    legacyMedicationPreference.notificationsEnabled &&
    legacyMedicationPreference.medications.length > 0 &&
    legacyMedicationPreference.medications.length === saved.cache?.medications.length &&
    legacyMedicationPreference.medications.every((med) =>
      saved.cache?.medications.some((cached) => cached.id === med.id),
    )
  )
    saved.medicationNotificationsEnabled = true;
  useCloudStore.setState({ ready: false, userId: owner, email: session.user.email ?? null });
  if (!Number.isSafeInteger(saved.firstLoginAt) || saved.firstLoginAt! < 0)
    saved.firstLoginAt = Date.now();
  persist();
  try {
    const remote = await cloudApi<Remote>("/v1/me", undefined, session.user.id);
    if (epoch !== generation) return;
    if (saved.queue.length) {
      if (saved.cache) hydrate(saved.cache);
    } else if (remote.game) {
      saved.revision = remote.game.revision;
      const h = remote.health_profile;
      const parsed = h
        ? profileSchema.safeParse({
            ...h.details,
            name: remote.profile?.display_name,
            age: h.age,
            sex: h.sex,
            height: h.height_cm,
            weight: h.weight_kg,
            bloodPressure: h.onboarding_bp_text,
            glucose: h.fasting_glucose,
          })
        : null;
      const meds = medicationListSchema.parse(
        remote.medications.map((m) => ({ ...m, drugClass: m.drug_class })),
      );
      const batch = {
        game: remote.game.snapshot,
        profile: parsed?.success ? parsed.data : undefined,
        medications: meds,
        taken: remote.taken,
        avatar_id: remote.profile?.avatar_id ?? null,
        onboarding_completed: remote.profile?.onboarding_completed ?? false,
      } as Batch;
      hydrate(batch);
      saved.cache = batch;
      useCloudStore.setState({
        healthSnapshotKey: healthSnapshotKey(batch.profile, batch.medications, batch.game),
      });
    }
    if (!saved.consent) {
      const localSurveyGame = restoreGame(readDailySurveyGame(owner));
      if (Object.keys(localSurveyGame.dailySurveys).length)
        useGameStore.setState({ game: localSurveyGame, paused: localSurveyGame.battlePaused });
    }
    publish(saved.queue.length ? "기기에 보관된 기록 전송 대기" : "서버 기록 불러오기 완료");
  } catch {
    if (epoch !== generation) return;
    if (saved.cache) {
      hydrate(saved.cache);
      publish("오프라인 · 기기에 보관된 기록을 사용해요.");
    } else if (Object.keys(restoreGame(readDailySurveyGame(owner)).dailySurveys).length) {
      const localSurveyGame = restoreGame(readDailySurveyGame(owner));
      useGameStore.setState({ game: localSurveyGame, paused: localSurveyGame.battlePaused });
      publish("오프라인 · 이 계정의 기기 건강 기록을 사용해요.");
    } else {
      publish("서버 기록을 불러오지 못했어요. 연결 후 다시 로그인해 주세요.");
      useCloudStore.setState({ ready: true });
      owner = null;
      return;
    }
  }
  if (epoch !== generation) return;
  saved.firstLoginAt = useGameStore.getState().game.profileQuests.startedAt ?? saved.firstLoginAt;
  useGameStore
    .getState()
    .startProfileQuests(saved.firstLoginAt, useProfileStore.getState().onboardingCompleted);
  useSessionStore.getState().signIn();
  void useMedicationStore.getState().syncNotifications();
  hydrating = false;
  // tickBattle accounts for elapsed local background time; explicit logout pauses it.
  useGameStore.getState().tick();
  useCloudStore.setState({ ready: true });
  persist();
  void flushCloud();
}
export async function signOutCloud() {
  useGameStore.getState().suspendSession();
  capture();
  await flushCloud();
  try {
    await cloudApi(
      "/v1/devices/push",
      {
        device_id: deviceId,
        platform: Capacitor.getPlatform(),
        push_enabled: false,
      },
      owner ?? undefined,
    );
  } catch {
    /* Stored queue remains scoped to this account. */
  }
  generation++;
  hydrating = true;
  owner = null;
  await supabase.auth.signOut({ scope: "local" });
  await attach(null);
}
export const exchangeCallback = createCallbackHandler({
  origin: () => location.origin,
  exchange: async (code) => {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
  },
  closeBrowser: () => Browser.close(),
});
export async function socialLogin(provider: "google" | "kakao" | "naver") {
  if (provider === "google") {
    const { googleLogin } = await import("./google");
    return googleLogin();
  }
  const redirectTo = Capacitor.isNativePlatform()
    ? "com.rexrun.demo://auth/callback"
    : `${location.origin}/auth/callback`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: `custom:${provider}`,
    options: { redirectTo, skipBrowserRedirect: Capacitor.isNativePlatform() },
  });
  if (error) throw error;
  if (Capacitor.isNativePlatform() && data.url) await Browser.open({ url: data.url });
}
export async function enableQuestPush() {
  const pushOwner = owner;
  if (!pushOwner) throw new Error("AUTH_REQUIRED");
  if (!Capacitor.isNativePlatform()) {
    useCloudStore.setState({ pushMessage: "퀘스트 푸시는 갤럭시 APK에서 설정해 주세요." });
    return;
  }
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.createChannel({
    id: "rexrun-quests",
    name: "퀘스트 완료",
    importance: 4,
    visibility: 0,
  });
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") {
    useCloudStore.setState({ pushMessage: "알림 권한이 꺼져 있어요." });
    return;
  }
  await PushNotifications.addListener("registration", ({ value }) => {
    void cloudApi(
      "/v1/devices/push",
      {
        device_id: deviceId,
        platform: Capacitor.getPlatform(),
        push_enabled: true,
        app_version: nativeConfig.nativeVersion,
        push_token: value,
      },
      pushOwner,
    )
      .then(() => {
        useCloudStore.setState({ pushMessage: "퀘스트 푸시 토큰 서버 저장 완료" });
        return cloudApi("/v1/notifications/dispatch", {}, pushOwner);
      })
      .catch(() =>
        useCloudStore.setState({ pushMessage: "푸시 토큰 저장 실패 · 다시 설정해 주세요." }),
      );
  });
  await PushNotifications.addListener("registrationError", () =>
    useCloudStore.setState({ pushMessage: "FCM 등록 실패 · Firebase 설정을 확인해 주세요." }),
  );
  await PushNotifications.register();
}
export function startCloud() {
  if (!cloudEnabled || started) return;
  started = true;
  deviceId = localStorage.getItem("rexrun-cloud-device") ?? crypto.randomUUID();
  localStorage.setItem("rexrun-cloud-device", deviceId);
  void supabase.auth.getSession().then(({ data }) => attach(data.session));
  supabase.auth.onAuthStateChange((_event, session) => {
    void Promise.resolve().then(() => attach(session));
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    if (hydrating) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      capture();
      void flushCloud();
    }, 600);
  };
  useProfileStore.subscribe(changed);
  useMedicationStore.subscribe((a, b) => {
    if (!hydrating && owner && a.notificationsEnabled !== b.notificationsEnabled) {
      saved.medicationNotificationsEnabled = a.notificationsEnabled;
      persist();
    }
    if (a.medications !== b.medications || a.taken !== b.taken) changed();
  });
  useGameStore.subscribe((a, b) => {
    if (a.game.date !== b.game.date) capture(b.game);
    if (
      a.game.completed !== b.game.completed ||
      a.game.activity !== b.game.activity ||
      a.game.steps !== b.game.steps ||
      a.game.dailySurveys !== b.game.dailySurveys ||
      a.game.profileQuests !== b.game.profileQuests ||
      a.game.dinosaur !== b.game.dinosaur ||
      a.game.dinosaurStyles !== b.game.dinosaurStyles
    )
      changed();
  });
  window.setInterval(() => {
    capture();
    void flushCloud();
  }, 300000);
  window.addEventListener("online", () => {
    void flushCloud();
  });
  document.addEventListener("visibilitychange", () => {
    if (useSessionStore.getState().active) {
      useGameStore.getState().tick();
      capture();
      void flushCloud();
    }
  });
  if (Capacitor.isNativePlatform()) {
    void NativeApp.addListener("appUrlOpen", ({ url }) => {
      void exchangeCallback(url).catch(() =>
        publish("로그인 연결에 실패했어요. 다시 시도해 주세요."),
      );
    });
    void NativeApp.getLaunchUrl()
      .then((v) => v && exchangeCallback(v.url))
      .catch(() => publish("소셜 로그인 연결을 확인해 주세요."));
    void NativeApp.addListener("appStateChange", () => {
      if (useSessionStore.getState().active) {
        useGameStore.getState().tick();
        capture();
        void flushCloud();
      }
    });
  }
}
