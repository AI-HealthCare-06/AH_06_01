import { useState } from "react";
import { ToggleSwitch } from "./ToggleSwitch";
import { useQuestNotificationStore } from "../stores/quest-notification-store";
import {
  requestQuestNotificationPermission,
  questProgressSummary,
  type QuestNotificationPreferences,
} from "../services/quest-notifications";
import { useGameStore } from "../stores/game-store";
export function QuestNotificationSettings() {
  const { preferences, update, message } = useQuestNotificationStore();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const summary = questProgressSummary(useGameStore((s) => s.game));
  async function change(key: keyof QuestNotificationPreferences, value: boolean) {
    const owner = useQuestNotificationStore.getState().owner;
    setBusy(true);
    setError("");
    try {
      if (value) await requestQuestNotificationPermission();
      if (owner !== useQuestNotificationStore.getState().owner)
        throw new Error("계정이 변경됐어요. 다시 설정해 주세요.");
      update(key, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알림 권한을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="quest-notification-setting">
      <h3>퀘스트 알림</h3>
      <label>
        <span>아침·점심·저녁 실천 독려</span>
        <ToggleSwitch
          label="퀘스트 독려 알림"
          checked={preferences.reminders}
          disabled={busy}
          onChange={(v) => void change("reminders", v)}
        />
      </label>
      <small>
        09:00 서베이 · 12:30 식사 · 18:30 걷기 · 20:30 선택 퀘스트. 완료한 퀘스트는 취소해요.
      </small>
      <label>
        <span>알림창에 진행도 표시</span>
        <ToggleSwitch
          label="알림창 진행도"
          checked={preferences.progress}
          disabled={busy}
          onChange={(v) => void change("progress", v)}
        />
      </label>
      <div className="quest-notification-preview" aria-label="퀘스트 알림 미리보기">
        <strong>{summary.title}</strong>
        <p style={{ whiteSpace: "pre-line" }}>{summary.body}</p>
      </div>
      <small>
        Android 기기 알림 · 7일치 예약, 앱 실행 시 갱신해요. 절전·강제 종료·알림 권한에 따라 지연될
        수 있어요.
      </small>
      {(error || message) && <p role="status">{error || message}</p>}
    </section>
  );
}
