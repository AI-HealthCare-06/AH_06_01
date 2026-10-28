import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dailyDoses } from "../domain/medications";
import { validQuestProof } from "../domain/quest-verification";
import { useMedicationStore } from "../stores/medication-store";
import { useQuestVerificationStore } from "../stores/quest-verification-store";

export function MedicationQuestPanel({
  date,
  onAuthenticate,
  onRecorded,
  locked,
}: {
  date: string;
  onAuthenticate: (dose: string) => void;
  onRecorded: () => void;
  locked: boolean;
}) {
  const state = useMedicationStore();
  const proof = useQuestVerificationStore((s) => s.proofs.medicine);
  const [now, setNow] = useState(Date.now);
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
  const doses = dailyDoses(state.medications, date, state.taken);
  return (
    <section
      className="cream-card medication-card camera-medication-quests"
      id="medication-records"
      aria-label="오늘의 복약 퀘스트"
    >
      <header>
        <h3>오늘의 복약 퀘스트</h3>
        <b>
          {doses.filter((d) => d.taken).length} / {doses.length}
        </b>
      </header>
      <p>{date.replaceAll("-", ".")} · 사진 인증 후 복용·투약을 기록해요.</p>
      {!doses.length ? (
        <p className="empty-state">등록된 복약 일정이 없어요.</p>
      ) : (
        <ul className="dose-list">
          {doses.map((dose) => (
            <li key={dose.key}>
              <time>{dose.time}</time>
              <div>
                <strong>{dose.medication.name}</strong>
                <span>{dose.medication.dose || "등록된 용량 없음"}</span>
              </div>
              <div className="dose-verification-actions">
                {!dose.taken && (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => onAuthenticate(dose.key)}
                    aria-label={dose.medication.name + " " + dose.time + " 사진 인증"}
                  >
                    사진 인증
                  </button>
                )}
                <button
                  type="button"
                  disabled={dose.taken || !validQuestProof(proof, "medicine", now, dose.key)}
                  aria-label={
                    dose.medication.name +
                    " " +
                    dose.time +
                    " " +
                    (dose.taken ? "복용 완료" : "복용 기록")
                  }
                  onClick={() => {
                    if (state.markTaken(dose.medication.id, dose.time)) onRecorded();
                  }}
                >
                  {dose.taken ? "완료" : "복용 기록"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <small>인증을 위해 약을 다시 복용·투약하지 마세요.</small>
      <Link to="/medications">복약 일정 관리 ›</Link>
    </section>
  );
}
