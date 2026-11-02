import { describe, it, expect } from "vitest";
import { createDemoGame } from "./demo-persona";
import { quarterDemoPersona } from "./demo-personas";
import { dashboardInsights } from "./dashboard-insights";
import { sleepHoursFromTimes } from "./daily-survey";
import { profileSchema } from "./profile";
import { medicationListSchema } from "./medications";
import { initialGame } from "./game";
import type { MealRecord } from "./diet";
import { demoAnalysisInputKey } from "./demo-analysis-input";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import analysis from "../design/demo-quarter-analysis.json";
describe("90-day demonstration and dashboard aggregates", () => {
  it("binds the recorded model result to the fixture and invalidates medication/health changes", () => {
    expect(
      createHash("sha256")
        .update(readFileSync(new URL("../design/demo-persona-quarter.json", import.meta.url)))
        .digest("hex"),
    ).toBe(analysis.provenance.fixtureSha256);
    const profile = profileSchema.parse(quarterDemoPersona.profile),
      meds = medicationListSchema.parse(quarterDemoPersona.medications),
      game = createDemoGame("2026-11-02", Date.parse("2026-11-02T12:00:00Z"), quarterDemoPersona);
    const key = demoAnalysisInputKey(profile, meds, game);
    expect(demoAnalysisInputKey({ ...profile, name: "이름만 변경" }, meds, game)).toBe(key);
    expect(demoAnalysisInputKey({ ...profile, smoking: true }, meds, game)).not.toBe(key);
    expect(
      demoAnalysisInputKey(profile, [{ ...meds[0], name: "다른 약" }, ...meds.slice(1)], game),
    ).not.toBe(key);
  });
  it("has 90 valid daily surveys, actual clock-derived sleep and no future days", () => {
    profileSchema.parse(quarterDemoPersona.profile);
    medicationListSchema.parse(quarterDemoPersona.medications);
    const game = createDemoGame(
      "2026-11-02",
      Date.parse("2026-11-02T12:00:00+09:00"),
      quarterDemoPersona,
    );
    expect(Object.keys(game.dailySurveys)).toHaveLength(90);
    expect(Object.keys(game.dailySurveys).sort()[0]).toBe("2026-08-05");
    expect(quarterDemoPersona.records.flatMap((r) => r.meals ?? [])).toHaveLength(180);
    for (const row of Object.values(game.dailySurveys))
      expect(row.sleepHours).toBe(sleepHoursFromTimes(row.bedtime, row.wakeTime));
    const data = dashboardInsights(game, [], "quarter", game.date);
    expect(data.dayCount).toBe(90);
    expect(data.rows).toHaveLength(90);
    expect(data.heatmap).toHaveLength(90);
    expect(data.comparison.map((c) => c.days)).toEqual([30, 30]);
    expect(data.comparison[1].systolic!).toBeLessThan(data.comparison[0].systolic!);
    expect(dashboardInsights(game, [], "week", game.date).rows).toHaveLength(7);
  });
  it("keeps missing measurements missing and zero quest completions distinct", () => {
    const game = initialGame("2026-11-02");
    game.healthHistory = {
      "2026-11-01": { steps: 0, sleepHours: null, systolic: null, glucose: null },
    };
    const data = dashboardInsights(game, [], "week", game.date);
    expect(data.rows[0].steps).toBe(0);
    expect(data.rows[0].sleep).toBeNull();
    expect(data.heatmap.filter((d) => d.row === null)).not.toHaveLength(0);
  });
  it("does not turn partial nutrient data into complete meal totals or full-day intake", () => {
    const nutrient = { energy_kcal: 500, carb_g: 60, protein_g: 20, fat_g: 20, sodium_mg: null };
    const meals = [
      {
        id: "meal",
        date: "2026-11-02",
        items: [{ nutrients: nutrient }, { nutrients: { ...nutrient, carb_g: null } }],
      },
    ] as unknown as MealRecord[];
    const data = dashboardInsights(initialGame("2026-11-02"), meals, "week", "2026-11-02");
    expect(data.nutrition.energy).toBe(1000);
    expect(data.nutrition.sodium).toBeNull();
    expect(data.nutrition.macroMeals).toBe(0);
    expect(data.nutrition.macroShares).toEqual([null, null, null]);
  });
});
