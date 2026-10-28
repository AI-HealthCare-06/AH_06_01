// Sample history only; the profile has no connected health-risk service yet.
export const healthPeriods = {
  day: { label: "일간", heading: "DAILY", previous: "어제", delta: 1, values: [76, 78, 80, 82] },
  week: {
    label: "주간",
    heading: "WEEKLY",
    previous: "지난주",
    delta: 8,
    values: [74, 76, 75, 78, 79, 81, 82],
  },
  month: {
    label: "월간",
    heading: "MONTHLY",
    previous: "지난달",
    delta: 14,
    values: [68, 73, 78, 82],
  },
  year: {
    label: "연간",
    heading: "YEARLY",
    previous: "지난해",
    delta: 26,
    values: [58, 59, 62, 61, 65, 68, 69, 72, 74, 77, 80, 82],
  },
  custom: {
    label: "기간",
    heading: "PERIOD",
    previous: "이전 기간",
    delta: 8,
    values: [74, 76, 75, 78, 79, 81, 82],
  },
} as const;
export type HealthPeriod = keyof typeof healthPeriods;

export function reportSelection(params: URLSearchParams, today: string) {
  const candidate = params.get("period");
  const period: HealthPeriod =
    candidate && Object.hasOwn(healthPeriods, candidate) ? (candidate as HealthPeriod) : "week";
  const validDate = (value: string | null) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= today
    );
  };
  const date = validDate(params.get("date")) ? params.get("date")! : today;
  const from =
    validDate(params.get("from")) && params.get("from")! <= date ? params.get("from")! : date;
  return { period, date, from };
}

export function reportDateRange(period: HealthPeriod, end: string, from?: string) {
  const date = new Date(`${end}T12:00:00`);
  if (period === "custom") return { start: from && from <= end ? from : end, end };
  if (period === "week") date.setDate(date.getDate() - 6);
  if (period === "month") date.setDate(1);
  if (period === "year") date.setMonth(0, 1);
  return {
    start: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    end,
  };
}
