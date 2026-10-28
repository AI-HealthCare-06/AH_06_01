import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { AppShell, PageHeading } from "../components/AppShell";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { MedicationEditor } from "../components/MedicationEditor";
import { conditionLabel } from "../domain/profile";
import { useMedicationStore } from "../stores/medication-store";
import { useProfileStore } from "../stores/profile-store";
import {
  exactMedicationAlarmAllowed,
  openExactMedicationAlarmSetting,
} from "../services/medication-notifications";

export function MedicationPage() {
  const state = useMedicationStore();
  const conditions = useProfileStore((s) => s.profile.conditions);
  const [exact, setExact] = useState(false);
  const native = Capacitor.getPlatform() === "android";
  useEffect(() => {
    const refresh = () => {
      if (native)
        void exactMedicationAlarmAllowed()
          .then(setExact)
          .catch(() => setExact(false));
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [native]);
  return (
    <AppShell active="quests">
      <PageHeading title="MEDICATION" subtitle="" />
      <section className="cream-card medication-card">
        <header className="medication-heading">
          <h3>복용 중인 약 / 영양제</h3>
          <div className="medication-reminder-toggle">
            <span>알림</span>
            <ToggleSwitch
              label="복용 시간 알림"
              checked={state.notificationsEnabled}
              disabled={!native || state.busy}
              onChange={(value) => void state.setNotifications(value)}
            />
          </div>
        </header>
        <small
          id="medication-notification-hint"
          className="medication-notification-hint"
          role="status"
        >
          {state.busy ? "알림 설정 중…" : state.message}
          {!native && " 시간 알림은 갤럭시 APK에서 설정해 주세요."}
        </small>
        {native && !exact && (
          <button
            className="medication-alarm-setting"
            onClick={() => void openExactMedicationAlarmSetting().catch(() => undefined)}
          >
            정확한 알람 허용 설정 ›
          </button>
        )}
        <MedicationEditor
          value={state.medications}
          onChange={state.replaceMedications}
          conditions={conditions.map(conditionLabel)}
        />
        <Link className="medication-camera-shortcut" to="/camera?quest=medicine">
          카메라에서 복약 인증하기 ›
        </Link>
      </section>
    </AppShell>
  );
}
