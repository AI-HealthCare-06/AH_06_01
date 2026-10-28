import { create } from "zustand";
export const textSizes = [
  { value: "system", label: "기기 설정 (기본)", scale: 1 },
  { value: "small", label: "작게 · 90%", scale: 0.9 },
  { value: "large", label: "크게 · 115%", scale: 1.15 },
  { value: "larger", label: "더 크게 · 130%", scale: 1.3 },
] as const;
type TextSize = (typeof textSizes)[number]["value"];
function read(): TextSize {
  try {
    const saved = localStorage.getItem("rexrun-text-size");
    return textSizes.find((s) => s.value === saved)?.value ?? "system";
  } catch {
    return "system";
  }
}
function apply(value: TextSize) {
  const item = textSizes.find((s) => s.value === value)!;
  document.documentElement.style.setProperty("--ui-text-scale", String(item.scale));
  document.documentElement.dataset.textSize = value;
}
export const useTextSizeStore = create<{ value: TextSize; set: (value: TextSize) => void }>(
  (set) => ({
    value: read(),
    set: (value) => {
      try {
        localStorage.setItem("rexrun-text-size", value);
      } catch {
        /* Session-only setting. */
      }
      apply(value);
      set({ value });
    },
  }),
);
export function initializeTextSize() {
  apply(useTextSizeStore.getState().value);
}
