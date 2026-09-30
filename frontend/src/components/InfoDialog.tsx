import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function InfoDialog({
  title,
  onClose,
  children,
  returnFocusTo,
  onConfirm,
  confirmLabel = "확인",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  returnFocusTo?: HTMLElement | null;
  onConfirm?: () => void;
  confirmLabel?: string;
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
        <div className="dialog-body">{children}</div>
        <button autoFocus className="primary-button" onClick={onConfirm ?? onClose}>
          {confirmLabel}
        </button>
        {onConfirm && (
          <button className="dialog-cancel" onClick={onClose}>
            취소
          </button>
        )}
      </div>
    </dialog>
  );
}
