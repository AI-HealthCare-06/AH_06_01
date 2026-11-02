// Reproducible fictional demo inputs. Never patient records or treatment-effect estimates.
import { readFileSync, writeFileSync } from "node:fs";
import { format } from "prettier";
const folder = new URL("../src/design/", import.meta.url);
const legacy = JSON.parse(readFileSync(new URL("demo-persona.json", folder), "utf8"));
const round = (v, decimals = 0) => Number(v.toFixed(decimals));
const clock = (m) =>
  `${String(Math.floor(((m + 1440) % 1440) / 60)).padStart(2, "0")}:${String((m + 1440) % 60).padStart(2, "0")}`;
const records = Array.from({ length: 90 }, (_, i) => {
  const progress = i / 89,
    wobble = Math.sin(i * 1.7),
    setback = i >= 38 && i <= 43 ? 1 : 0;
  const minutes = round((335 + progress * 90 + Math.sin(i * 0.8) * 20 - setback * 30) / 5) * 5;
  const bedtime = round(20 - progress * 55 + Math.sin(i * 0.5) * 15);
  const steps = Math.max(
    1200,
    round((2600 + progress * 4700 + wobble * 850 - setback * 1800) / 100) * 100,
  );
  const systolic = round(151 - progress * 17 + wobble * 4 + setback * 7),
    diastolic = round(96 - progress * 11 + Math.cos(i * 1.2) * 3 + setback * 4);
  const completed = [
    ...(i % 19 === 4 ? [] : ["medicine"]),
    ...(i % 11 === 3 ? [] : ["meal"]),
    ...(steps >= 6000 ? ["walk"] : []),
    ...(i % 4 !== 2 ? ["water"] : []),
  ];
  const meals = ["lunch", "dinner"].map((slot, n) => {
    const energy = round(720 - progress * 100 + Math.sin(i + n) * 55),
      protein = round(25 + progress * 9 + n * 3),
      fat = round(24 - progress * 5 + Math.cos(i + n) * 3);
    return {
      slot,
      name: n ? "데모 · 채소와 생선 정식" : "데모 · 잡곡밥과 단백질 한 끼",
      grams: round(440 + Math.sin(i) * 35),
      nutrients: {
        energy_kcal: energy,
        carb_g: round((energy - protein * 4 - fat * 9) / 4, 1),
        sugar_g: round(14 - progress * 5, 1),
        protein_g: protein,
        fat_g: fat,
        sat_fat_g: round(fat * 0.25, 1),
        sodium_mg: round(1350 - progress * 500 + Math.sin(i) * 120),
        fiber_g: round(5 + progress * 4, 1),
        potassium_mg: round(650 + progress * 200),
        cholesterol_mg: round(70 + Math.cos(i) * 10),
      },
    };
  });
  return {
    steps,
    sleepHours: minutes / 60,
    systolic,
    diastolic,
    evening: { systolic: systolic - 2, diastolic: diastolic - 1 },
    restingHr: round(83 - progress * 10 + Math.sin(i) * 3),
    glucose: i % 23 === 7 ? null : round(159 - progress * 29 + Math.sin(i * 0.7) * 8),
    completed,
    survey: {
      bedtime: clock(bedtime),
      wakeTime: clock(bedtime + minutes),
      activeMinutes: Math.max(0, round(12 + progress * 29 + wobble * 5 - setback * 10)),
      sedentaryHours: round(10.5 - progress * 2.8 + Math.cos(i) * 0.5, 1),
      snoringScore: i % 17 === 9 ? null : round(5 - progress * 2),
      daytimeSleepinessScore: i % 17 === 9 ? null : round(6 - progress * 4),
      nocturia: i % 6 === 0,
    },
    meals,
  };
});
const fixture = {
  id: "studio-quarter-v1",
  title: "시연용 민준 · 90일",
  banner: "DEMO · 42세 민준 / 합성 90일 기록",
  revision: "studio-quarter-20261102-v1",
  note: "Entirely fictional 90-day product demonstration. Variations and gradual changes are authored scenarios, not medical evidence, observations or treatment effects.",
  provenance: {
    preparedOn: "2026-11-02",
    recordWindow: "rolling 90 days ending on demo startup date",
    generator: "frontend/scripts/create-quarter-demo.mjs",
    source: "authored synthetic scenario",
    meals:
      "Two fictional recorded meals per day, not complete daily intake; manually entered synthetic nutrient snapshots.",
  },
  profile: {
    ...legacy.profile,
    name: "시연용 민준",
    age: 42,
    height: 175,
    weight: 82,
    bloodPressure: "151 / 96",
    glucose: 130,
    restingHeartRate: 74,
    waistCm: 96,
    htnStatus: "on_medication",
    conditionStatus: "selected",
    conditions: ["hypertension", "diabetes"],
    sleepHours: 7,
    activeMinutesWeek: 240,
    alcoholDays: 1,
    alcoholWeek: 3,
    hypertensionFamily: true,
  },
  medications: legacy.medications,
  startingLevel: 3,
  startingGold: 2500,
  completeFirstWeek: true,
  records,
  m2: legacy.m2,
};
writeFileSync(
  new URL("demo-persona-quarter.json", folder),
  await format(JSON.stringify(fixture), { parser: "json" }),
);
console.log("Created fictional 90-day persona with 180 recorded meal snapshots.");
