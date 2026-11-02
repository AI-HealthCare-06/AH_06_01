import legacy from "../design/demo-persona.json";
import office from "../design/demo-persona-office-month.json";
import quarter from "../design/demo-persona-quarter.json";
import type { Nutrients } from "./diet";

export type DemoPersona = {
  id: string;
  title: string;
  banner: string;
  revision: string;
  profile: unknown;
  medications: unknown[];
  startingLevel?: number;
  startingGold?: number;
  completeFirstWeek?: boolean;
  records: Array<{
    steps: number;
    sleepHours: number;
    systolic: number;
    diastolic: number;
    evening?: { systolic: number; diastolic: number };
    restingHr: number | null;
    glucose: number | null;
    completed: string[];
    meals?: Array<{ slot: "lunch" | "dinner"; name: string; grams: number; nutrients: Nutrients }>;
    survey: {
      bedtime: string;
      wakeTime: string;
      activeMinutes: number;
      sedentaryHours: number;
      snoringScore: number | null;
      daytimeSleepinessScore: number | null;
      nocturia: boolean | null;
    };
  }>;
};

export const legacyDemoPersona: DemoPersona = {
  ...legacy,
  title: "고혈압·당뇨 7일",
  banner: "DEMO · 고혈압·당뇨 페르소나 / 합성 7일 기록",
};
export const officeMonthPersona: DemoPersona = office;
export const quarterDemoPersona = quarter as DemoPersona;
export const demoPersonas = [quarterDemoPersona, officeMonthPersona, legacyDemoPersona];
export function selectedDemoPersona(): DemoPersona {
  try {
    const id =
      localStorage.getItem("rexrun-persona-id") ?? import.meta.env.VITE_REXRUN_DEMO_PERSONA_ID;
    return demoPersonas.find((p) => p.id === id) ?? legacyDemoPersona;
  } catch {
    return legacyDemoPersona;
  }
}
