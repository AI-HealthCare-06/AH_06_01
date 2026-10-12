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
} as const;
export type HealthPeriod = keyof typeof healthPeriods;
