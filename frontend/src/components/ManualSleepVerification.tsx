import { useEffect, useState, type FormEvent } from "react";
import { localDate } from "../domain/calendar";
import { selfReportedSleepMinutes } from "../domain/quest-verification";
import { useQuestVerificationStore } from "../stores/quest-verification-store";
import { useSessionStore } from "../stores/session-store";
import { QuestHelp } from "./QuestHelp";

export function ManualSleepVerification({ completed }: { completed: boolean }) {
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("0");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const active = useSessionStore((state) => state.active);
  const proof = useQuestVerificationStore((state) => state.proofs.sleep);
  const total = selfReportedSleepMinutes(hours, minutes);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [proof]);
  const freshReport =
    proof?.source === "self-report" &&
    proof.date === localDate() &&
    proof.verifiedAt <= now &&
    now - proof.verifiedAt <= 30 * 60_000;
  const edit = () => {
    setConfirmed(false);
    setError("");
    useQuestVerificationStore.getState().clearSleepReport();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (completed) return;
    const accepted = useQuestVerificationStore
      .getState()
      .selfReportSleep(hours, minutes, confirmed, localDate());
    setError(accepted ? "" : "시간과 확인 항목을 다시 확인해 주세요.");
  };
  const status =
    error ||
    (completed
      ? "오늘 수면 인증 완료"
      : freshReport
        ? "직접 입력 " +
          Math.floor(proof.minutes! / 60) +
          "시간 " +
          (proof.minutes! % 60) +
          "분 · " +
          (proof.minutes! >= 420 ? "확인 완료" : "7시간 이상 필요")
        : "");
  return (
    <section
      className="quest-verification cream-card manual-sleep"
      aria-label="수면 직접 입력 인증"
    >
      <div className="quest-card-heading">
        <h2>수면 시간 입력</h2>
        <QuestHelp title="수면 직접 입력 안내" label="수면 입력 도움말">
          <p>워치 없이 오늘 잔 시간을 직접 입력하는 자기보고 인증이에요.</p>
          <p>
            0분 초과~24시간, 분은 0~59로 입력해 주세요. 7시간 이상 확인하면 퀘스트를 완료할 수
            있어요.
          </p>
          <p>
            시간 수정·확인 해제·앱 재실행 시 다시 확인해 주세요. 확인은 오늘 30분 동안 유효해요.
          </p>
        </QuestHelp>
      </div>
      <form aria-label="수면 시간 직접 입력" onSubmit={submit} data-no-swipe>
        <fieldset disabled={completed || !active}>
          <legend>오늘의 수면 · {localDate().slice(5).replace("-", ".")}</legend>
          <div className="sleep-duration-inputs">
            <label>
              시간
              <input
                aria-label="수면 시간"
                type="number"
                inputMode="numeric"
                placeholder="0~24"
                title="0~24시간"
                min="0"
                max="24"
                step="1"
                required
                value={hours}
                onChange={(event) => {
                  edit();
                  setHours(event.target.value);
                }}
              />
            </label>
            <label>
              분
              <input
                aria-label="수면 분"
                type="number"
                inputMode="numeric"
                placeholder="0~59"
                title="0~59분"
                min="0"
                max="59"
                step="1"
                required
                value={minutes}
                onChange={(event) => {
                  edit();
                  setMinutes(event.target.value);
                }}
              />
            </label>
          </div>
          <label className="sleep-report-confirmation">
            <input
              type="checkbox"
              aria-label="오늘 잔 수면 시간을 사실대로 입력했어요."
              checked={confirmed}
              onChange={(event) => {
                useQuestVerificationStore.getState().clearSleepReport();
                setError("");
                setConfirmed(event.target.checked);
              }}
            />
            <span>실제 수면 시간이에요</span>
          </label>
          <button
            className="secondary-button"
            type="submit"
            aria-label="입력한 수면 시간 확인"
            disabled={!confirmed || total === null || completed || !active}
          >
            입력 확인
          </button>
        </fieldset>
      </form>
      {status && (
        <p role="status" className="sleep-report-status">
          {status}
        </p>
      )}
    </section>
  );
}
