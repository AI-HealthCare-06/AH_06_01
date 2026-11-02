import legacy from "../design/demo-persona.json";
import office from "../design/demo-persona-office-month.json";

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
export function selectedDemoPersona(): DemoPersona {
  try {
    return (localStorage.getItem("rexrun-persona-id") ??
      import.meta.env.VITE_REXRUN_DEMO_PERSONA_ID) === office.id
      ? officeMonthPersona
      : legacyDemoPersona;
  } catch {
    return legacyDemoPersona;
  }
}
