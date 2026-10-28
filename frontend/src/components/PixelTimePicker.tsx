import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { RepeatButton } from "./RepeatButton";

const pad = (value: number | string) => String(value).padStart(2, "0");

export function PixelTimePicker({
  label,
  value,
  onChange,
  context = "medication",
}: {
  context?: "medication" | "survey";
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="pixel-time-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-time={value}
        onClick={() => setOpen(true)}
      >
        <span>{value || "시간 선택"}</span>
        <span aria-hidden="true">설정 ▾</span>
      </button>
      {open && (
        <TimeDialog
          label={label}
          context={context}
          value={value}
          returnFocusTo={trigger}
          onClose={() => setOpen(false)}
          onSelect={(time) => {
            onChange(time);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function TimeDialog({
  context,
  label,
  value,
  returnFocusTo,
  onClose,
  onSelect,
}: {
  context: "medication" | "survey";
  label: string;
  value: string;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initialFocus = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [parts, setParts] = useState(value ? value.split(":") : ["", ""]);
  const valid = parts.every((part, i) => /^\d{1,2}$/.test(part) && Number(part) <= (i ? 59 : 23));
  const update = (index: number, value: string) =>
    setParts((current) => current.map((part, i) => (i === index ? value : part)));
  const apply = () => {
    if (valid) onSelect(parts.map((part) => pad(Number(part))).join(":"));
  };
  useEffect(() => {
    const node = dialog.current;
    const trigger = returnFocusTo.current;
    node?.showModal();
    initialFocus.current?.focus();
    return () => {
      node?.close();
      trigger?.focus();
    };
  }, [returnFocusTo]);
  return (
    <dialog
      ref={dialog}
      className="pixel-time-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.target === event.currentTarget &&
          (event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom)
        )
          onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          apply();
        }
      }}
      data-no-swipe
    >
      <header>
        <div>
          <small>{context === "survey" ? "DAILY SURVEY" : "DAILY MEDICATION"}</small>
          <h2 id={titleId}>{label} 설정</h2>
        </div>
        <button type="button" aria-label="시간 설정 닫기" onClick={onClose}>
          ×
        </button>
      </header>
      <p>
        {context === "survey"
          ? "어젯밤 취침 · 오늘 기상 · 24시간 기준"
          : "매일 같은 시간 · 24시간 기준"}
      </p>
      <div className="pixel-time-columns">
        {parts.map((part, i) => {
          const name = i ? "분" : "시";
          const max = i ? 59 : 23;
          const partValid = /^\d{1,2}$/.test(part) && Number(part) <= max;
          const adjust = (delta: number) =>
            update(i, pad(((Number(part) || 0) + delta + max + 1) % (max + 1)));
          return (
            <div className="pixel-time-column" key={i}>
              <span>
                {name} · 00–{max}
              </span>
              <RepeatButton
                ref={i === 0 ? initialFocus : undefined}
                type="button"
                aria-label={`${name} 늘리기`}
                onRepeat={() => adjust(1)}
              >
                ▲
              </RepeatButton>
              <input
                aria-label={name}
                aria-invalid={!partValid}
                type="text"
                inputMode="numeric"
                maxLength={2}
                autoComplete="off"
                value={part}
                onFocus={(event) => event.target.select()}
                onChange={(event) => {
                  if (/^\d{0,2}$/.test(event.target.value)) update(i, event.target.value);
                }}
                onBlur={() => {
                  if (partValid) update(i, pad(Number(part)));
                }}
              />
              <RepeatButton aria-label={`${name} 줄이기`} onRepeat={() => adjust(-1)}>
                ▼
              </RepeatButton>
            </div>
          );
        })}
      </div>
      {!valid && <p role="alert">시는 00–23, 분은 00–59로 입력해 주세요.</p>}
      <footer>
        <button type="button" onClick={onClose}>
          취소
        </button>
        <button type="button" disabled={!valid} onClick={apply}>
          시간 적용
        </button>
      </footer>
    </dialog>
  );
}
