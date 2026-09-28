import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function InfoDialog({
  title,
  onClose,
  children,
  returnFocusTo,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  returnFocusTo?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      className="cream-card info-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div>
        <h2 id="dialog-title">{title}</h2>
        <p>{children}</p>
        <button autoFocus className="primary-button" onClick={onClose}>
          확인
        </button>
      </div>
    </dialog>
  );
}
