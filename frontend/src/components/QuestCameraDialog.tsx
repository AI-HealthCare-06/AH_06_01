import { useEffect, useId, useRef } from "react";
import { quests } from "../domain/game";
import { QuestCamera, type CameraQuest } from "../pages/CameraPage";

export function QuestCameraDialog({
  quest,
  trigger,
  onClose,
}: {
  quest: CameraQuest;
  trigger: HTMLButtonElement;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      trigger.focus();
    };
  }, [trigger]);
  return (
    <dialog
      ref={dialog}
      className="quest-camera-dialog cream-card"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{quests.find((q) => q.id === quest)!.title} 인증</h2>
        <button type="button" autoFocus aria-label="카메라 닫기" onClick={onClose}>
          ×
        </button>
      </header>
      <QuestCamera fixedQuest={quest} />
    </dialog>
  );
}
