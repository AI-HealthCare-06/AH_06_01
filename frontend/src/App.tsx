import { MealPage } from "./pages/MealPage";
import "./diet.css";
import { CvProcessPage } from "./pages/CvProcessPage";
import "./cv-process.css";
import { demoMode } from "./domain/demo-mode";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, type Location } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { HomePage, QuestsPage, DashboardPage, ShopPage, CharacterPage } from "./pages/MainPages";
import { LoginPage, ProfilePage, DinosaurPage, FirstResultPage } from "./pages/OnboardingPages";
import { QuestDetailPage, RewardPage, BuffPage, MyPage } from "./pages/ScenarioPages";
import { RiskPage, WitheredPage } from "./pages/StatePages";
import { useGameStore } from "./stores/game-store";
import { useDeviceStore } from "./stores/device-store";
import { startStepUpdates } from "./services/step-updates";
import { CameraPage } from "./pages/CameraPage";
import { useBattleFeedbackStore } from "./stores/battle-feedback-store";
import { dinosaurs } from "./design/dinosaurs";
import { sendBattleFailureNotification } from "./services/battle-notifications";
import { MedicationPage } from "./pages/MedicationPage";
import { useSessionStore } from "./stores/session-store";
import { useMedicationStore } from "./stores/medication-store";
import { DailySurveyDialog } from "./pages/DailySurveyPage";
import "./daily-survey.css";
import "./profile-quests.css";
import { useProfileStore } from "./stores/profile-store";
import { beforeMobileUpdateApply, startMobileUpdates } from "./services/mobile-updates";
import { capture, startCloud, useCloudStore } from "./cloud/sync";
import { startDinosaurAppIcon } from "./services/dinosaur-app-icon";
import { CloudLoginPage, AuthCallbackPage } from "./cloud/CloudLoginPage";
import { cloudEnabled } from "./cloud/client";
import { GameLoadingScreen } from "./components/GameLoadingScreen";

export default function App() {
  const [booting, setBooting] = useState(() => Capacitor.isNativePlatform());
  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 600);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    startCloud();
    beforeMobileUpdateApply(() => {
      useGameStore.getState().tick();
      capture();
    });
    startDinosaurAppIcon();
    void startMobileUpdates();
  }, []);
  const location = useLocation();
  const navigate = useNavigate();
  const surveyOpen = location.pathname === "/daily-survey";
  const surveyBackground = (location.state as { surveyBackground?: Location } | null)
    ?.surveyBackground;
  const background =
    surveyOpen &&
    surveyBackground &&
    ["/home", "/quests", "/dashboard", "/dashboard/report"].includes(surveyBackground.pathname)
      ? surveyBackground
      : null;
  const routeLocation = surveyOpen
    ? (background ?? { ...location, pathname: "/quests", search: "", hash: "", state: null })
    : location;
  const active = useSessionStore((s) => s.active);
  const cloudReady = useCloudStore((s) => s.ready);
  useEffect(() => {
    if (active && cloudReady)
      useGameStore
        .getState()
        .startProfileQuests(undefined, useProfileStore.getState().onboardingCompleted);
  }, [active, cloudReady]);
  const refreshDay = useGameStore((s) => s.refreshDay);
  const tick = useGameStore((s) => s.tick);
  useEffect(() => {
    const unsubscribe = useGameStore.subscribe((next, previous) => {
      if (!useSessionStore.getState().active) return;
      const failure = next.game.combat.lastFailure;
      if (failure && failure.time !== previous.game.combat.lastFailure?.time) {
        useBattleFeedbackStore.getState().show("defeat");
        const name = dinosaurs[next.game.dinosaur].name;
        sendBattleFailureNotification(
          `REXRUN · WAVE ${failure.wave} 클리어 실패`,
          `${name}: 퀘스트로 힘을 모아 다시 도전해요.`,
        );
      } else if (
        next.game.combat.transition &&
        !previous.game.combat.transition &&
        !next.game.combat.transition.arrived
      ) {
        useBattleFeedbackStore.getState().show("clear");
      }
      // A background catch-up can include both a defeat and revival in one tick.
      if (
        useBattleFeedbackStore.getState().status === "defeat" &&
        next.game.combat.recovery === 0 &&
        next.game.combat.hp > 0
      ) {
        useBattleFeedbackStore.getState().clear();
      }
    });
    const session = useSessionStore.subscribe((next) => {
      if (!next.active) useBattleFeedbackStore.getState().clear();
    });
    return () => {
      unsubscribe();
      session();
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") tick();
    }, 50);
    const sync = () => {
      tick();
      refreshDay();
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pagehide", sync);
    };
  }, [tick, refreshDay, active]);
  const syncSteps = useDeviceStore((s) => s.sync);
  const stepsEnabled = useDeviceStore((s) => s.enabled);
  const backgroundRevision = useDeviceStore((s) => s.backgroundRevision);
  useEffect(() => {
    if (!active || demoMode || !stepsEnabled) return;
    const stop = startStepUpdates({
      sync: syncSteps,
      accept: (snapshot) => useDeviceStore.getState().acceptSnapshot(snapshot),
      status: (status) => useDeviceStore.setState({ backgroundMessage: status.message }),
    });
    const unsubscribe = useSessionStore.subscribe((session) => {
      if (!session.active) stop();
    });
    return () => {
      unsubscribe();
      stop();
    };
  }, [syncSteps, active, stepsEnabled, backgroundRevision]);
  useEffect(() => {
    if (!active) return;
    window.scrollTo(0, 0);
    refreshDay();
  }, [routeLocation.pathname, refreshDay, active]);
  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      if (document.visibilityState === "visible") refreshDay();
    };
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refreshDay, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [refreshDay, active]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || demoMode) return;
    if (active) void useMedicationStore.getState().syncNotifications();
    const lifecycle = NativeApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive && useSessionStore.getState().active) {
        void useMedicationStore.getState().syncNotifications();
      }
    });
    const notification = LocalNotifications.addListener(
      "localNotificationActionPerformed",
      ({ notification }) => {
        if (notification.extra?.group === "rexrun-update") navigate("/me?updates=1");
        if (notification.extra?.group === "rexrun-medication" && useSessionStore.getState().active)
          navigate("/medications");
      },
    );
    return () => {
      void lifecycle.then((handle) => handle.remove());
      void notification.then((handle) => handle.remove());
    };
  }, [active, navigate]);
  if (booting || (cloudEnabled && !cloudReady))
    return <GameLoadingScreen stage={cloudEnabled && !cloudReady ? "account" : "boot"} />;
  if (
    !active &&
    !(cloudEnabled ? ["/login", "/signup", "/auth/callback"] : ["/login", "/profile"]).includes(
      location.pathname,
    )
  )
    return <Navigate to="/login" replace />;
  return (
    <>
      <Routes location={routeLocation}>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/quests" element={<QuestsPage />} />
        <Route path="/cv" element={<CvProcessPage />} />
        <Route path="/meals" element={<MealPage />} />
        <Route path="/medications" element={<MedicationPage />} />
        <Route path="/quests/:id" element={<QuestDetailPage />} />
        <Route
          path="/camera"
          element={
            new URLSearchParams(location.search).has("quest") ? (
              <CameraPage key={location.search} />
            ) : (
              <Navigate to="/quests" replace />
            )
          }
        />
        <Route path="/dashboard" element={<DashboardPage key="summary" />} />
        <Route path="/dashboard/report" element={<DashboardPage key="report" detailed />} />
        <Route
          path="/dashboard/character"
          element={<Navigate to={"/dashboard" + location.search} replace />}
        />
        <Route
          path="/dashboard/character/report"
          element={<Navigate to={"/dashboard/report" + location.search} replace />}
        />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/character" element={<CharacterPage />} />
        <Route path="/shop/customize" element={<ShopPage customize />} />
        <Route path="/login" element={cloudEnabled ? <CloudLoginPage /> : <LoginPage />} />
        <Route path="/signup" element={<CloudLoginPage signup />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/dinosaur" element={<DinosaurPage />} />
        <Route path="/first-result" element={<FirstResultPage />} />
        <Route path="/reward" element={<RewardPage />} />
        <Route path="/buff" element={<BuffPage />} />
        <Route path="/risk" element={<RiskPage />} />
        <Route path="/withered" element={<WitheredPage />} />
        <Route path="/me" element={<MyPage />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
      {surveyOpen && (
        <DailySurveyDialog
          onClose={() => (background ? navigate(-1) : navigate("/quests", { replace: true }))}
        />
      )}
    </>
  );
}
