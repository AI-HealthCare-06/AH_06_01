import type { GameState } from "./game";
import type { BpStageResult } from "./bp-stage";
import { reportDateRange, type HealthPeriod } from "../services/health-history";

export type PressureValue = { systolic: number; diastolic: number };
type Reading = PressureValue & { date: string; slot: "아침" | "저녁" | "기록" };
export type PressureDay = PressureValue & { date: string; readings: Reading[] };

export function validPressure(value: unknown): value is PressureValue {
  if (!value || typeof value !== "object") return false;
  const { systolic: s, diastolic: d } = value as PressureValue;
  return Number.isFinite(s) && Number.isFinite(d) && d >= 10 && s > d && s <= 999;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function pressureDays(
  game: Pick<GameState, "date" | "dailySurveys" | "healthHistory">,
): PressureDay[] {
  const dates = new Set([...Object.keys(game.healthHistory), ...Object.keys(game.dailySurveys)]);
  return [...dates]
    .filter((date) => validDate(date) && date <= game.date)
    .sort()
    .flatMap((date) => {
      const survey = game.dailySurveys[date];
      const readings: Reading[] = [];
      if (survey) {
        // An explicit unmeasured survey supersedes an older history snapshot.
        if (survey.date === date && survey.bloodPressureStatus === "measured") {
          for (const [slot, value] of [
            ["아침", survey.morning],
            ["저녁", survey.evening],
          ] as const) {
            if (validPressure(value)) readings.push({ ...value, date, slot });
          }
        }
      } else {
        const history = game.healthHistory[date];
        if (validPressure(history))
          readings.push({
            systolic: history.systolic,
            diastolic: history.diastolic,
            date,
            slot: "기록",
          });
      }
      return readings.length ? [{ date, ...pressureMean(readings), readings }] : [];
    });
}

function pressureMean(rows: PressureValue[]): PressureValue {
  return {
    systolic: rows.reduce((sum, row) => sum + row.systolic, 0) / rows.length,
    diastolic: rows.reduce((sum, row) => sum + row.diastolic, 0) / rows.length,
  };
}

export function profilePressure(value: string | null): PressureValue | null {
  const match = value?.match(/^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/);
  if (!match) return null;
  const pressure = { systolic: Number(match[1]), diastolic: Number(match[2]) };
  return validPressure(pressure) ? pressure : null;
}

export function dashboardPressure(
  game: Pick<GameState, "date" | "dailySurveys" | "healthHistory">,
  period: HealthPeriod,
  end: string,
  from?: string,
  undatedInput: string | null = null,
) {
  const all = pressureDays(game);
  const undated = profilePressure(undatedInput);
  const range = reportDateRange(period, end, from);
  const days = all.filter((day) => day.date >= range.start && day.date <= range.end);
  const latest = days.at(-1)?.readings.at(-1) ?? null;
  const previous = all.filter((day) => day.date < range.start).at(-1) ?? null;
  const blockSize = Math.min(7, Math.floor(days.length / 2));
  const first = days.slice(0, blockSize);
  const last = blockSize ? days.slice(-blockSize) : [];
  const sameDay = days.length === 1 && days[0].readings.length === 2;
  const firstMean = blockSize ? pressureMean(first) : sameDay ? days[0].readings[0] : null;
  const lastMean = blockSize ? pressureMean(last) : sameDay ? days[0].readings[1] : null;
  const trend =
    firstMean && lastMean
      ? {
          systolic: lastMean.systolic - firstMean.systolic,
          diastolic: lastMean.diastolic - firstMean.diastolic,
          comparison: sameDay
            ? "같은 날 아침 → 저녁"
            : `초반 ${blockSize}개 기록일 → 최근 ${blockSize}개 기록일`,
          first: firstMean,
          last: lastMean,
        }
      : null;
  return {
    mode: all.length || undated ? ("measured" as const) : ("lifestyle" as const),
    range,
    days,
    latest,
    previous,
    trend,
    undated: all.length ? null : undated,
    average: days.length ? pressureMean(days) : null,
    readingCount: days.reduce((sum, day) => sum + day.readings.length, 0),
  };
}

// Only the retained M1 and its existing screening policy are approved here.
// Research EBM v9/cost150 and other experimental responses fail closed.
export function approvedLifestyleResult(result: BpStageResult | undefined) {
  return Boolean(
    result &&
    result.feature_version === "1.2.0" &&
    ["M1-20261020_150607-nested__base", "M1-20261020_150607-nested__base-htn-screen-v1"].includes(
      result.model_version,
    ) &&
    ["ok", "partial"].includes(result.data_quality),
  );
}

export function pressureChange(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? "변화 없음" : `${rounded > 0 ? "↑" : "↓"} ${Math.abs(rounded).toFixed(1)}`;
}
