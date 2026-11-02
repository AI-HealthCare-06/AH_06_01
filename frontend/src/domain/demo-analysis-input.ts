import type { HealthProfile } from "./profile";
import type { Medication } from "./medications";
import type { GameState } from "./game";
export class DemoInputChangedError extends Error {
  constructor() {
    super("시연 입력이 변경됐어요. 시연 초기화로 기록된 분석을 다시 볼 수 있어요.");
    this.name = "DemoInputChangedError";
  }
}

// Include all health answers and active medication details, not UI-only profile names.
export function demoAnalysisInputKey(
  profile: HealthProfile,
  medications: Medication[],
  game: Pick<GameState, "date" | "dailySurveys">,
) {
  const { name: displayName, ...health } = profile;
  void displayName;
  const recent = Object.entries(game.dailySurveys)
    .filter(([date]) => date <= game.date)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([date, survey]) => {
      const { submittedAt, ...answers } = survey;
      void submittedAt;
      return [date, answers];
    });
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, v]) => [key, canonical(v)]),
          )
        : value;
  return JSON.stringify(
    canonical([
      health,
      medications.filter((m) => m.active).sort((a, b) => a.id.localeCompare(b.id)),
      recent,
    ]),
  );
}
