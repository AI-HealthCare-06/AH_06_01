import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { readDeviceSleep } from "../services/device-sleep";
import { useSessionStore } from "../stores/session-store";
import { useQuestVerificationStore } from "../stores/quest-verification-store";
import { ManualSleepVerification } from "./ManualSleepVerification";
import { QuestHelp } from "./QuestHelp";

export function SleepConnection({ completed = false }: { completed?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const web = Capacitor.getPlatform() === "web";
  return (
    <>
      <ManualSleepVerification completed={completed} />
      <section
        className="quest-verification cream-card sleep-health-connection"
        aria-label="수면 인증"
      >
        <div className="quest-card-heading">
          <h2>건강 앱 연동</h2>
          <QuestHelp title="건강 앱 수면 인증 안내" label="건강 앱 연동 도움말">
            <p>
              {web
                ? "웹에서는 수면 기록을 읽을 수 없어요. 수면 읽기 권한이 포함된 모바일 APK에서 연결해 주세요."
                : "삼성 헬스·워치에서 Health Connect로 공유한 오늘의 수면 기록을 확인해요."}
            </p>
            <p>
              수면 읽기 권한을 허용해 주세요. 오늘 끝난 실제 수면 단계가 7시간 이상이면 완료할 수
              있어요.
            </p>
          </QuestHelp>
        </div>
        <div className="sleep-health-action">
          <span>{web ? "모바일 전용" : "워치 · 삼성 헬스"}</span>
          <button
            className="secondary-button"
            disabled={web || busy}
            onClick={async () => {
              setBusy(true);
              const session = useSessionStore.getState();
              try {
                const result = await readDeviceSleep(true);
                if (!session.active || useSessionStore.getState() !== session) return;
                useQuestVerificationStore
                  .getState()
                  .sleep(result.minutes, result.source, result.date);
                setMessage(
                  "확인된 수면 " +
                    Math.floor(result.minutes / 60) +
                    "시간 " +
                    (result.minutes % 60) +
                    "분 · 7시간 이상이면 완료할 수 있어요.",
                );
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : "수면 기록을 확인하지 못했어요.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "수면 확인 중…" : "수면 기록 연결·확인"}
          </button>
        </div>
        {message && <p role="status">{message}</p>}
      </section>
    </>
  );
}
