import { mainQuestIds, questCountOn, type GameState } from "./game";
import type { MealRecord, NutrientKey } from "./diet";
import { latestSurveyPressure } from "./daily-survey";
import { reportDateRange, type HealthPeriod } from "../services/health-history";

export const dayOffset = (date: string, n: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const mean = (values: (number | null | undefined)[]) => {
  const present = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
};
export function dashboardInsights(
  game: GameState,
  meals: MealRecord[],
  period: HealthPeriod,
  end: string,
  from?: string,
) {
  const range = reportDateRange(period, end, from);
  const dayCount = Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86400000) + 1;
  const mealRows = meals.filter((m) => m.date >= range.start && m.date <= range.end);
  const dates = new Set([
    ...Object.keys(game.healthHistory),
    ...Object.keys(game.dailySurveys),
    ...Object.keys(game.questHistoryDetails),
    ...Object.keys(game.questHistory),
    ...mealRows.map((m) => m.date),
  ]);
  if (!game.sampleDay) dates.add(game.date);
  const rows = [...dates]
    .filter((date) => date >= range.start && date <= range.end && date <= game.date)
    .sort()
    .map((date) => {
      const history = game.healthHistory[date],
        survey = game.dailySurveys[date],
        pressure = survey ? latestSurveyPressure(survey) : null;
      const current = date === game.date && !game.sampleDay;
      const hasActivity = Boolean(
        history ||
        survey ||
        Object.hasOwn(game.questHistory, date) ||
        Object.hasOwn(game.questHistoryDetails, date) ||
        current,
      );
      return {
        date,
        systolic: survey ? (pressure?.systolic ?? null) : (history?.systolic ?? null),
        diastolic: survey ? (pressure?.diastolic ?? null) : (history?.diastolic ?? null),
        glucose: survey ? survey.fastingGlucose : (history?.glucose ?? null),
        pulse: survey ? survey.restingHr : (history?.restingHr ?? null),
        sleep: survey
          ? survey.sleepHours
          : current
            ? game.sleepHours
            : (history?.sleepHours ?? null),
        steps: current && game.steps?.date === date ? game.steps.count : (history?.steps ?? null),
        active: survey?.activeMinutes ?? null,
        sedentary: survey?.sedentaryHours ?? null,
        bedtime: survey?.bedtime ?? null,
        wakeTime: survey?.wakeTime ?? null,
        completed: hasActivity ? questCountOn(game, date) : null,
        survey: !!survey,
      };
    });
  const nutrient = (meal: MealRecord, key: NutrientKey) => {
    const v = meal.items.map((item) => item.nutrients[key]);
    return v.every((v) => typeof v === "number" && Number.isFinite(v))
      ? v.reduce<number>((a, b) => a + b!, 0)
      : null;
  };
  const macroMeals = mealRows.filter((m) =>
    (["carb_g", "protein_g", "fat_g"] as const).every((key) => nutrient(m, key) !== null),
  );
  const macroEnergy = (["carb_g", "protein_g", "fat_g"] as const).map((key, i) =>
    macroMeals.reduce((sum, m) => sum + nutrient(m, key)! * (i === 2 ? 9 : 4), 0),
  );
  const macroTotal = macroEnergy.reduce((a, b) => a + b, 0);
  const heatStart = dayCount > 90 ? dayOffset(end, -89) : range.start;
  const heatLength = Math.min(90, dayCount);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const heatmap = Array.from({ length: heatLength }, (_, i) => {
    const date = dayOffset(heatStart, i);
    return { date, row: byDate.get(date) ?? null };
  });
  const comparison =
    dayCount >= 60
      ? [
          { label: "초반 30일", start: range.start, end: dayOffset(range.start, 29) },
          { label: "최근 30일", start: dayOffset(end, -29), end },
        ].map((block) => {
          const source = rows.filter((r) => r.date >= block.start && r.date <= block.end);
          return {
            ...block,
            days: source.length,
            systolic: mean(source.map((r) => r.systolic)),
            diastolic: mean(source.map((r) => r.diastolic)),
            sleep: mean(source.map((r) => r.sleep)),
            steps: mean(source.map((r) => r.steps)),
          };
        })
      : [];
  return {
    range,
    dayCount,
    rows,
    heatmap,
    comparison,
    mainQuestCount: mainQuestIds.length,
    nutrition: {
      meals: mealRows.length,
      days: new Set(mealRows.map((m) => m.date)).size,
      energy: mean(mealRows.map((m) => nutrient(m, "energy_kcal"))),
      energyMeals: mealRows.filter((m) => nutrient(m, "energy_kcal") !== null).length,
      sodium: mean(mealRows.map((m) => nutrient(m, "sodium_mg"))),
      sodiumMeals: mealRows.filter((m) => nutrient(m, "sodium_mg") !== null).length,
      macroMeals: macroMeals.length,
      macroShares: macroEnergy.map((v) => (macroTotal ? v / macroTotal : null)),
    },
  };
}
export type DashboardInsights = ReturnType<typeof dashboardInsights>;
