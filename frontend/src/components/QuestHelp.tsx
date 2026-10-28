import { useState, type ReactNode } from "react";
import { InfoDialog } from "./InfoDialog";

export function QuestHelp({
  title,
  label,
  children,
}: {
  title: string;
  label: string;
  children: ReactNode;
}) {
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        className="quest-help-button"
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={!!trigger}
        onClick={(event) => setTrigger(event.currentTarget)}
      >
        <span aria-hidden="true">!</span>
      </button>
      {trigger && (
        <InfoDialog title={title} returnFocusTo={trigger} onClose={() => setTrigger(null)}>
          {children}
        </InfoDialog>
      )}
    </>
  );
}
