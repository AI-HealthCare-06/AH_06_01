import { useState } from "react";
import { textSizes, useTextSizeStore } from "../stores/text-size-store";
import { InfoDialog } from "./InfoDialog";
export function TextSizeSetting() {
  const { value, set } = useTextSizeStore();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        className="cream-card settings-summary-row"
        onClick={(e) => setTrigger(e.currentTarget)}
      >
        <span>
          <strong>글자 크기</strong>
          <small>{textSizes.find((s) => s.value === value)?.label}</small>
        </span>
        <b aria-hidden="true">›</b>
      </button>
      {trigger && (
        <InfoDialog
          title="글자 크기"
          onClose={() => setTrigger(null)}
          returnFocusTo={trigger}
          confirmLabel="닫기"
        >
          <fieldset className="font-size-options">
            <legend>기기 글자 크기 기준</legend>
            {textSizes.map((s) => (
              <label key={s.value}>
                <input
                  type="radio"
                  name="text-size"
                  value={s.value}
                  checked={value === s.value}
                  onChange={() => set(s.value)}
                />
                {s.label}
              </label>
            ))}
          </fieldset>
        </InfoDialog>
      )}
    </>
  );
}
