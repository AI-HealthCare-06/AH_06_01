import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { HomePage, QuestsPage, DashboardPage, ShopPage, CharacterPage } from "./pages/MainPages";
import { LoginPage, ProfilePage, DinosaurPage, FirstResultPage } from "./pages/OnboardingPages";
import { QuestDetailPage, RewardPage, BuffPage, MyPage } from "./pages/ScenarioPages";
import { RiskPage, WitheredPage } from "./pages/StatePages";
import { useGameStore } from "./stores/game-store";
import { useDeviceStore } from "./stores/device-store";
import { CameraPage } from "./pages/CameraPage";
import { useNotice } from "./components/NoticeProvider";
import { dinosaurs } from "./design/dinosaurs";
import { sendBattleFailureNotification } from "./services/battle-notifications";

export default function App() {
  const location = useLocation();
  const refreshDay = useGameStore((s) => s.refreshDay);
  const tick = useGameStore((s) => s.tick);
  const notice = useNotice();
  useEffect(
    () =>
      useGameStore.subscribe((next, previous) => {
        const failure = next.game.combat.lastFailure;
        if (!failure || failure.time === previous.game.combat.lastFailure?.time) return;
        const name = dinosaurs[next.game.dinosaur].name;
        const message = `${name}: 잠깐 쉬어가도 괜찮아요! 퀘스트로 힘을 모아 다시 도전해요.`;
        notice(`STAGE ${failure.stage} · WAVE ${failure.wave} 클리어 실패 · ${message}`);
        sendBattleFailureNotification(`REXRUN · WAVE ${failure.wave} 클리어 실패`, message);
      }),
    [notice],
  );
  useEffect(() => {
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
  }, [tick, refreshDay]);
  const syncSteps = useDeviceStore((s) => s.sync);
  useEffect(() => {
    void syncSteps();
    const sync = () => {
      if (document.visibilityState === "visible") void syncSteps();
    };
    const timer = window.setInterval(sync, 30_000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [syncSteps]);
  useEffect(() => {
    window.scrollTo(0, 0);
    refreshDay();
  }, [location.pathname, refreshDay]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") refreshDay();
    };
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refreshDay, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [refreshDay]);
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/quests" element={<QuestsPage />} />
      <Route path="/quests/:id" element={<QuestDetailPage />} />
      <Route path="/camera" element={<CameraPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/shop" element={<ShopPage />} />
      <Route path="/character" element={<CharacterPage />} />
      <Route path="/shop/customize" element={<ShopPage customize />} />
      <Route path="/login" element={<LoginPage />} />
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
  );
}
