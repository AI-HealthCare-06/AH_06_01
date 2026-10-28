import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useGameStore } from "../stores/game-store";
import { profileQuests, profileQuestStatus, profileQuestDeadline } from "../domain/profile-quests";

export function ProfileQuests({ compact = false }: { compact?: boolean }) {
  const progress = useGameStore((s) => s.game.profileQuests);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (progress.startedAt === null) return null;
  const remaining = profileQuests.filter((q) => !progress.completed[q.id]);
  if (!remaining.length && compact) return null;
  const deadline = profileQuestDeadline(progress);
  const expired = remaining.every((q) => profileQuestStatus(progress, q.id, now) === "expired");
  if (compact)
    return (
      <Link className="profile-quest-shortcut cream-card" to="/quests#first-week-quests">
        <div>
          <strong>첫 주 건강 기록 퀘스트</strong>
          <small>
            {expired
              ? "보상 기간 종료 · 건강 정보는 계속 기록할 수 있어요"
              : remaining.length + "개 남음 · " + deadline + "까지 완료 시 각 200 EXP"}
          </small>
        </div>
        <b aria-hidden="true">›</b>
      </Link>
    );
  return (
    <section
      className="profile-quests cream-card"
      id="first-week-quests"
      aria-label="첫 주 건강 기록 퀘스트"
    >
      <header>
        <h3>첫 주 건강 기록 퀘스트</h3>
        <span>
          {profileQuests.length - remaining.length} / {profileQuests.length}
        </span>
      </header>
      <p>
        {remaining.length ? (
          <>최초 로그인부터 7일 · {deadline}까지 완료하면 각 200 EXP를 한 번 받아요.</>
        ) : (
          "지병·생활습관 기록을 모두 마쳤어요. 필요할 때 정보를 수정할 수 있어요."
        )}
      </p>
      <div className="profile-quest-list">
        {profileQuests.map((q) => {
          const status = profileQuestStatus(progress, q.id, now),
            receipt = progress.completed[q.id];
          return (
            <Link
              key={q.id}
              className="profile-quest"
              to={`/profile?mode=quest&quest=${q.id}`}
              data-status={status}
            >
              <span className={`checkbox ${receipt ? "checked" : ""}`} aria-hidden="true" />
              <div>
                <strong>{q.title}</strong>
                <small>{q.description}</small>
                <small>
                  {receipt
                    ? receipt.experience
                      ? "완료 · 보상 지급됨"
                      : "기록 완료"
                    : status === "expired"
                      ? "보상 기간 종료 · 기록은 계속할 수 있어요"
                      : "기록하기 ›"}
                </small>
              </div>
              <b>
                {receipt
                  ? receipt.experience
                    ? `+${receipt.experience} EXP`
                    : "완료"
                  : status === "available"
                    ? "+200 EXP"
                    : "기록"}
              </b>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
