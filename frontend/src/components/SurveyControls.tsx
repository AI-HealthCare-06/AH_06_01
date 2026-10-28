import { useEffect, useId, useRef, useState } from "react";

export function SurveyChoices({
  label,
  value,
  choices,
  onChange,
  scale = false,
}: {
  label: string;
  value: string;
  choices: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  scale?: boolean;
}) {
  const name = useId();
  if (scale) {
    const known = value !== "unknown" && value !== "";
    return (
      <fieldset className="survey-choices survey-slider" aria-label={label} data-no-swipe>
        <legend>{label}</legend>
        <output htmlFor={name} aria-live="polite">
          {known ? `${value} / 10` : value === "unknown" ? "모름" : "점수를 선택해 주세요"}
        </output>
        <input
          id={name}
          type="range"
          aria-label={label}
          aria-valuetext={known ? `${value}점` : "아직 응답하지 않음"}
          min={0}
          max={10}
          step={1}
          value={known ? value : "0"}
          onPointerDown={(e) => {
            if (!known) onChange(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (
              !known &&
              ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)
            )
              onChange("0");
          }}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="survey-scale-anchors">
          <span>0 · 없음</span>
          <span>10 · 매우 심함</span>
        </div>
        <button
          type="button"
          className="survey-unknown-button"
          aria-pressed={value === "unknown"}
          onClick={() => onChange("unknown")}
        >
          모름
        </button>
      </fieldset>
    );
  }
  return (
    <fieldset
      className={`survey-choices${scale ? " survey-likert" : ""}`}
      role="radiogroup"
      aria-label={label}
    >
      <legend>{label}</legend>
      <div className="survey-options">
        {choices.map((choice) => (
          <label key={choice.value} className={choice.value === "unknown" ? "survey-unknown" : ""}>
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SurveyHelp({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div
      className="survey-help"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label={label + " 설명"}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        ?
      </button>
      {open && (
        <div id={id} role="tooltip">
          {text}
        </div>
      )}
    </div>
  );
}
