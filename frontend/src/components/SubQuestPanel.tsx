import { quests, type Quest } from "../domain/game";
import { rankSubQuests } from "../domain/quest-analysis";
import { useQuestAnalysis } from "../services/useQuestAnalysis";
import { useMedicationStore } from "../stores/medication-store";
import { useGameStore } from "../stores/game-store";
import { QuestModelSummary } from "./QuestModelSummary";
export function SubQuestPanel({
  onChoose,
}: {
  onChoose: (quest: Quest, trigger: HTMLButtonElement) => void;
}) {
  const query = useQuestAnalysis();
  const medications = useMedicationStore((s) => s.medications);
  const completed = useGameStore((s) => s.game.completed);
  const ranked = query.data
    ? rankSubQuests(
        query.data,
        medications.some((m) => m.active),
      )
    : [];
  return (
    <section className="sub-quest-panel" aria-label="Sub Quest 추천">
      <header>
        <h3>선택 서브 퀘스트</h3>
      </header>
      <button
        type="button"
        className="sub-quest-card cream-card"
        aria-haspopup="dialog"
        onClick={(e) =>
          onChoose(
            quests.find((q) => q.id === "water")!,
            e.currentTarget,
          )
        }
      >
        <span className="sub-quest-rank">+</span>
        <div>
          <h4>물 마시기 실천</h4>
          <p>선택해서 실천해요. 메인 퀘스트 모두 완료 조건에는 포함되지 않아요.</p>
          <small>{completed.includes("water") ? "오늘 완료" : "동작 인증하기 ›"}</small>
        </div>
      </button>
      <header>
        <h3>오늘 우선 실천</h3>
        <p>전날 실천과 M1·M2 응답을 참고한 규칙 기반 추천이에요.</p>
      </header>
      {ranked
        .filter((item) => item.quest !== "water")
        .map((item, index) => {
          const quest = quests.find((q) => q.id === item.quest)!;
          return (
            <button
              type="button"
              key={item.quest}
              className="sub-quest-card cream-card"
              aria-haspopup="dialog"
              onClick={(event) => onChoose(quest, event.currentTarget)}
            >
              <span className="sub-quest-rank">0{index + 1}</span>
              <div>
                <h4>{quest.title}</h4>
                <p>{item.reason}</p>
                <small>
                  {completed.includes(item.quest) ? "오늘 완료" : "퀘스트 확인 ›"}
                  {item.modelCodes.length ? " · M2 확인 항목 참고" : " · 전날 실천 참고"}
                </small>
              </div>
            </button>
          );
        })}
      {query.data && !ranked.length && (
        <p className="cream-card sub-quest-empty">
          추천할 전날 기록이 충분하지 않아요. 기본 퀘스트부터 기록해 보세요.
        </p>
      )}
      <small className="analysis-note">
        기본 퀘스트와 같은 인증·보상을 사용하며 중복 보상은 지급하지 않아요.
      </small>
      <QuestModelSummary />
    </section>
  );
}
