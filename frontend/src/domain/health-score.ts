import { mainQuestIds, questCountOn, type GameState } from "./game";
import { reportDateRange, type HealthPeriod } from "../services/health-history";

// A record-based habit score, separate from BP reference bands and model risk.
// Keep the goals identical to the dashboard rings and the existing quest policy.
const goals = { steps: 6000, sleep: 7, quests: mainQuestIds.length };
const metricIds = ["steps", "quests", "sleep"] as const;
type Metric = (typeof metricIds)[number];
type Values = Record<Metric, number | null>;
type Range = { start: string; end: string };
type Day = { date: string; values: Values };

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const valid = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const percent = (value: number | null, goal: number) =>
  value === null ? null : Math.min(100, (value / goal) * 100);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (date: string) => new Date(`${date}T12:00:00Z`);
const offset = (date: string, days: number) => {
  const next = utc(date);
  next.setUTCDate(next.getUTCDate() + days);
  return iso(next);
};

function dailyValues(game: GameState, date: string): Values {
  if (date > game.date) return { steps: null, sleep: null, quests: null };
  const current = date === game.date && !game.sampleDay;
  const row = game.healthHistory[date];
  const survey = game.dailySurveys[date];
  const steps = valid(current && game.steps?.date === date ? game.steps.count : row?.steps);
  const sleep = valid(
    survey
      ? survey.sleepStatus === "reported"
        ? survey.sleepHours
        : null
      : current
        ? (game.sleepHours ?? row?.sleepHours)
        : row?.sleepHours,
  );
  const hasQuests =
    Object.hasOwn(game.questHistory, date) ||
    Object.hasOwn(game.questHistoryDetails, date) ||
    game.completedDates.includes(date) ||
    Boolean(survey) ||
    (current &&
      (steps !== null ||
        sleep !== null ||
        game.completed.length > 0 ||
        Object.keys(game.activity).length > 0));
  return { steps, sleep, quests: hasQuests ? questCountOn(game, date) : null };
}

function summarize(days: Day[]) {
  const metrics = metricIds.map((id) => {
    const values = days.map((day) => day.values[id]).filter((v): v is number => v !== null);
    const value = average(values);
    // Average daily capped attainment, so excess steps on one day cannot make
    // up for a missed goal on another day.
    const attainment = average(values.map((v) => percent(v, goals[id])!));
    return {
      id,
      value,
      percent: attainment === null ? null : Math.round(attainment),
      attainment,
      days: values.length,
      total: values.reduce((sum, v) => sum + v, 0),
    };
  });
  const score = average(
    metrics.flatMap((metric) => (metric.attainment === null ? [] : [metric.attainment])),
  );
  return {
    score: score === null ? null : Math.round(score),
    metrics,
    recordedDays: days.filter((day) => metricIds.some((id) => day.values[id] !== null)).length,
  };
}

function previousRange(period: HealthPeriod, range: Range): Range {
  if (period === "month") {
    const end = offset(range.start, -1);
    return { start: `${end.slice(0, 7)}-01`, end };
  }
  if (period === "year") {
    const year = Number(range.start.slice(0, 4)) - 1;
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  const length = Math.round((utc(range.end).getTime() - utc(range.start).getTime()) / 86400000) + 1;
  return { start: offset(range.start, -length), end: offset(range.start, -1) };
}

export function healthScorePeriod(
  game: GameState,
  period: HealthPeriod,
  date: string,
  from?: string,
) {
  const range = reportDateRange(period, date, from);
  const previous = previousRange(period, range);
  // Iterate stored dates rather than every calendar day, including long custom
  // ranges. Missing dates stay missing and never receive fabricated zeroes.
  const dates = new Set([
    game.date,
    ...Object.keys(game.healthHistory),
    ...Object.keys(game.dailySurveys),
    ...Object.keys(game.questHistory),
    ...Object.keys(game.questHistoryDetails),
    ...game.completedDates,
  ]);
  const days = [...dates]
    .filter((day) => day <= game.date)
    .sort()
    .map((day) => ({ date: day, values: dailyValues(game, day) }));
  const within = (range: Range) =>
    days.filter((day) => day.date >= range.start && day.date <= range.end);
  const current = summarize(within(range));
  const baseline = summarize(within(previous));
  // Comparing different available metrics would suggest a change caused only
  // by missing data. Show a delta only when both periods contain the same set.
  const comparable = current.metrics.every(
    (metric, i) => (metric.percent === null) === (baseline.metrics[i].percent === null),
  );
  const delta =
    comparable && current.score !== null && baseline.score !== null
      ? current.score - baseline.score
      : null;
  const length = Math.round((utc(range.end).getTime() - utc(range.start).getTime()) / 86400000) + 1;
  const count = period === "year" ? Number(range.end.slice(5, 7)) : Math.min(7, length);
  const points = Array.from({ length: count }, (_, i) => {
    const start =
      period === "year"
        ? `${range.start.slice(0, 4)}-${String(i + 1).padStart(2, "0")}-01`
        : offset(range.start, Math.floor((i * length) / count));
    const next =
      period === "year"
        ? i === 11
          ? `${Number(range.start.slice(0, 4)) + 1}-01-01`
          : `${range.start.slice(0, 4)}-${String(i + 2).padStart(2, "0")}-01`
        : offset(range.start, Math.floor(((i + 1) * length) / count));
    const end = next > range.end ? range.end : offset(next, -1);
    return {
      start,
      end,
      label:
        period === "year"
          ? `${i + 1}월`
          : (i === count - 1 ? end : start).slice(5).replace("-", "."),
      ...summarize(within({ start, end })),
    };
  });
  return { ...current, range, previous, delta, points };
}

export type HealthScore = ReturnType<typeof healthScorePeriod>;

export function scoreChangeText(result: HealthScore, previousLabel: string) {
  if (result.score === null) return "아직 점수를 계산할 기록이 없어요";
  if (result.delta === null) return `${previousLabel} 비교 기록 부족`;
  return `${previousLabel} 대비 ${result.delta > 0 ? "+" : ""}${result.delta}점`;
}
