import { describe, it, expect } from "vitest";
import {
  blankDietItem,
  canSaveDiet,
  displayNutrient,
  foodByCode,
  itemNutrition,
  nutritionSummary,
  validGrams,
  loadOfficialFoods,
} from "./diet";

describe("F6 reference nutrition", () => {
  it("loads official foods without changing legacy reference nutrition", async () => {
    await loadOfficialFoods();
    expect(foodByCode("D301-022000000-0001")?.per_100g.energy_kcal).toBe(166);
    expect(foodByCode("DEV-0001")?.per_100g.energy_kcal).toBe(143);
  });
  it("scales the supplied 100g values by confirmed weight", () => {
    const item = { ...blankDietItem(), name: "쌀밥", foodCode: "DEV-0001", grams: "150" };
    expect(itemNutrition(item).energy_kcal).toBe(214.5);
    expect(itemNutrition({ ...item, grams: "210" }).energy_kcal).toBe(300.3);
    expect(foodByCode("DEV-0001")?.serving_g).toBe(210);
  });
  it("preserves missing data and labels partial totals instead of inventing zeros", () => {
    const known = itemNutrition({
      ...blankDietItem(),
      name: "쌀밥",
      foodCode: "DEV-0001",
      grams: "150",
    });
    const unknown = itemNutrition({ ...blankDietItem(), name: "모둠초밥", grams: "300" });
    const summary = nutritionSummary([known, unknown]);
    expect(summary.totals.energy_kcal).toBe(214.5);
    expect(summary.known.energy_kcal).toBe(1);
    expect(summary.count).toBe(2);
    expect(summary.macro).toBeNull();
    expect(nutritionSummary([unknown]).totals.sodium_mg).toBeNull();
    expect(displayNutrient("sodium_mg", null)).toBe("—");
    expect(displayNutrient("sodium_mg", 0)).toBe("0");
  });
  it("calculates a macro energy split only with all required nutrient rows", () => {
    const row = itemNutrition({ ...blankDietItem(), foodCode: "DEV-0001", grams: "100" });
    const macro = nutritionSummary([row]).macro!;
    expect(macro.carb + macro.protein + macro.fat).toBeCloseTo(100);
  });
  it.each(["", "0", "4", "1501", "NaN", "Infinity", "1e3", "-10", "150,5"])(
    "rejects invalid consumed weight %s",
    (value) => expect(validGrams(value)).toBe(false),
  );
  it("requires review and rejects synthetic results as records", () => {
    const items = [{ ...blankDietItem(), name: "쌀밥", foodCode: "DEV-0001", grams: "150" }];
    expect(canSaveDiet(items, "vision", true)).toBe(true);
    expect(canSaveDiet(items, "vision", false)).toBe(false);
    expect(canSaveDiet(items, "sample", true)).toBe(false);
    expect(canSaveDiet([{ ...items[0], foodCode: "invalid" }], "manual", true)).toBe(false);
  });
});

it("does not round small known positive amounts into an exact zero", () => {
  expect(displayNutrient("sodium_mg", 3)).toBe("<50");
  expect(displayNutrient("energy_kcal", 1)).toBe("<10");
  expect(displayNutrient("sugar_g", 0.01)).toBe("<0.1");
  expect(displayNutrient("sodium_mg", 0)).toBe("0");
});
