import { z } from "zod";
import catalogData from "../design/f6-foods.json";

export const nutrientKeys = [
  "energy_kcal",
  "carb_g",
  "sugar_g",
  "protein_g",
  "fat_g",
  "sat_fat_g",
  "sodium_mg",
  "fiber_g",
  "potassium_mg",
  "cholesterol_mg",
] as const;
export type NutrientKey = (typeof nutrientKeys)[number];
export type Nutrients = Record<NutrientKey, number | null>;
export const catalogVersion = "f6-dev-sample-v1";
export const nutrientLabels: Record<NutrientKey, { name: string; unit: string }> = {
  energy_kcal: { name: "열량", unit: "kcal" },
  carb_g: { name: "탄수화물", unit: "g" },
  sugar_g: { name: "당류", unit: "g" },
  protein_g: { name: "단백질", unit: "g" },
  fat_g: { name: "지방", unit: "g" },
  sat_fat_g: { name: "포화지방", unit: "g" },
  sodium_mg: { name: "나트륨", unit: "mg" },
  fiber_g: { name: "식이섬유", unit: "g" },
  potassium_mg: { name: "칼륨", unit: "mg" },
  cholesterol_mg: { name: "콜레스테롤", unit: "mg" },
};
const numeric = z.number().finite().nonnegative().max(1_000_000).nullable();
export const nutrientSchema = z.object(
  Object.fromEntries(nutrientKeys.map((key) => [key, numeric])) as Record<
    NutrientKey,
    typeof numeric
  >,
);
export type Food = {
  food_code: string;
  name: string;
  category: string;
  serving_g: number;
  per_100g: Nutrients;
};
export const foods = catalogData as Food[];
const byCode = new Map(foods.map((food) => [food.food_code, food]));
export const foodByCode = (code: string | null) => (code ? byCode.get(code) : undefined);
export const mealSlotLabels = { breakfast: "아침", lunch: "점심", dinner: "저녁", snack: "간식" };
export type MealSlot = keyof typeof mealSlotLabels;
export const draftItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  nameInput: z.string().max(80),
  foodCode: z.string().nullable(),
  grams: z.string().max(20),
  estimatedGrams: z.number().finite().nullable(),
  confidence: z.number().finite().min(0).max(1).nullable(),
  portionHint: z.string().nullable(),
  isSoup: z.boolean(),
  suggestedCode: z.string().nullable(),
});
export type DietItem = z.infer<typeof draftItemSchema>;
export const validGrams = (text: string) =>
  /^\d{1,4}(\.\d{1,2})?$/.test(text) && Number(text) >= 5 && Number(text) <= 1500;
export function itemNutrition(item: DietItem): Nutrients {
  const food = foodByCode(item.foodCode);
  return Object.fromEntries(
    nutrientKeys.map((key) => [
      key,
      !food || !validGrams(item.grams) || food.per_100g[key] === null
        ? null
        : Math.round(food.per_100g[key]! * Number(item.grams)) / 100,
    ]),
  ) as Nutrients;
}
export function nutritionSummary(rows: Nutrients[]) {
  const totals = {} as Nutrients,
    known = {} as Record<NutrientKey, number>;
  for (const key of nutrientKeys) {
    const values = rows
      .map((row) => row[key])
      .filter((value): value is number => value !== null && Number.isFinite(value));
    known[key] = values.length;
    totals[key] = values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100
      : null;
  }
  const complete =
    rows.length > 0 &&
    ["carb_g", "protein_g", "fat_g"].every((key) => known[key as NutrientKey] === rows.length);
  const energy = complete ? totals.carb_g! * 4 + totals.protein_g! * 4 + totals.fat_g! * 9 : 0;
  const macro =
    energy > 0
      ? {
          carb: ((totals.carb_g! * 4) / energy) * 100,
          protein: ((totals.protein_g! * 4) / energy) * 100,
          fat: ((totals.fat_g! * 9) / energy) * 100,
        }
      : null;
  return { totals, known, count: rows.length, macro };
}
export function displayNutrient(key: NutrientKey, value: number | null) {
  if (value === null) return "—";
  const step =
    key === "energy_kcal" ? 10 : key === "sodium_mg" || key === "potassium_mg" ? 50 : 0.1;
  const rounded = Math.round(value / step) * step;
  if (value > 0 && rounded === 0) return `<${step}`;
  return rounded.toLocaleString("ko-KR", {
    maximumFractionDigits: step === 0.1 ? 1 : 0,
  });
}
export const mealRecordSchema = z.object({
  id: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  source: z.enum(["vision", "manual"]),
  catalogVersion: z.literal(catalogVersion),
  model: z.string().max(120).nullable(),
  createdAt: z.string().datetime(),
  items: z
    .array(draftItemSchema.extend({ nutrients: nutrientSchema }))
    .min(1)
    .max(12),
});
export type MealRecord = z.infer<typeof mealRecordSchema>;
export function canSaveDiet(items: DietItem[], source: string, confirmed: boolean) {
  return (
    source !== "sample" &&
    confirmed &&
    items.length > 0 &&
    items.length <= 12 &&
    items.every(
      (item) =>
        item.name.trim().length > 0 &&
        validGrams(item.grams) &&
        (!item.foodCode || !!foodByCode(item.foodCode)),
    )
  );
}
export function blankDietItem(): DietItem {
  return {
    id: crypto.randomUUID(),
    name: "",
    nameInput: "",
    foodCode: null,
    grams: "",
    estimatedGrams: null,
    confidence: null,
    portionHint: null,
    isSoup: false,
    suggestedCode: null,
  };
}
