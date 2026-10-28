import { Link } from "react-router-dom";
import { questConditions, questEffects, questRewards } from "../domain/quest-policy";
import type { Quest } from "../domain/game";
import { questProgressLabel } from "../domain/game";
import { questExperience } from "../domain/experience";
import { useGameStore } from "../stores/game-store";
import { InfoDialog } from "./InfoDialog";

export function QuestInfoDialog({
  quest,
  trigger,
  onClose,
  onAuthenticate,
}: {
  quest: Quest;
  trigger: HTMLButtonElement;
  onClose: () => void;
  onAuthenticate: () => void;
}) {
  const game = useGameStore((s) => s.game);
  const method = questConditions[quest.id];
  return (
    <InfoDialog
      title={quest.title}
      returnFocusTo={trigger}
      onClose={onClose}
      confirmLabel={quest.id === "survey" ? "서베이 작성" : "인증하기"}
      onConfirm={onAuthenticate}
    >
      <div className="quest-modal-copy">
        <p>{quest.reason}</p>
        <dl>
          <div>
            <dt>진행</dt>
            <dd>{questProgressLabel(game, quest)}</dd>
          </div>
          <div>
            <dt>최초 보상</dt>
            <dd>
              +{questExperience(quest.experience, game.experience)} EXP ·{" "}
              {questRewards[quest.id].gold} G
            </dd>
          </div>
        </dl>
        <p>{method}</p>
        <small>
          {questEffects[quest.id]}
          {quest.id === "survey"
            ? " · 건강 기록은 날짜별로 보관해요."
            : " · 버프는 오늘만 적용돼요."}
        </small>
        {quest.id === "medicine" && <small>사진 인증을 위해 약을 다시 복용·투약하지 마세요.</small>}
        <Link to={`/quests/${quest.id}`}>진행·보상 자세히 보기 ›</Link>
      </div>
    </InfoDialog>
  );
}
