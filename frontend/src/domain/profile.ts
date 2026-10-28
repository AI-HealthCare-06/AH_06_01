import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력해 주세요.").max(40).default("Min"),
  age: z.coerce.number().int().min(1, "나이를 확인해 주세요.").max(120),
  sex: z.enum(["female", "male"]),
  height: z.coerce.number().min(50, "키를 확인해 주세요.").max(250),
  weight: z.coerce.number().min(1, "몸무게를 확인해 주세요.").max(500),
  bloodPressure: z
    .string()
    .regex(/^\d{2,3}\s*\/\s*\d{2,3}$/, "혈압은 120 / 80 형식으로 입력해 주세요.")
    .nullable(),
  glucose: z.coerce.number().positive("혈당을 확인해 주세요.").max(1000).nullable(),
  smoking: z.boolean().nullable(),
  hypertensionFamily: z.boolean().nullable(),
  diabetesFamily: z.boolean().nullable(),
  conditions: z.array(z.string().min(1).max(80)).max(30).default([]),
  // Missing on legacy profiles: their existing [] answer remains "none".
  conditionStatus: z.enum(["none", "selected", "unknown"]).optional(),
  specialHistory: z.string().trim().max(1500).default(""),
  pregnancyStatus: z.enum(["none", "pregnant", "postpartum_6w", "unknown"]).default("unknown"),
  htnStatus: z.enum(["none", "diagnosed_untreated", "on_medication", "unknown"]).default("unknown"),
  alcoholDays: z.number().int().min(0).max(7).nullable().default(null),
  alcoholWeek: z.number().min(0).max(60).nullable().default(null),
  bingeMonthly: z.boolean().nullable().default(null),
  waistCm: z.number().min(50).max(150).nullable().default(null),
  restingHeartRate: z.number().int().min(1).max(300).nullable().default(null),
  educationYears: z.number().int().min(0).max(40).nullable().default(null),
  sleepHours: z.number().min(0).max(24).nullable().default(null),
  activeMinutesWeek: z.number().int().min(0).max(10080).nullable().default(null),
  familyHistory: z.array(z.enum(["hypertension", "diabetes", "stroke", "mi_early"])).default([]),
});
export type HealthProfile = z.infer<typeof profileSchema>;
export const initialProfile: HealthProfile = {
  name: "Min",
  age: 45,
  sex: "female",
  height: 165,
  weight: 68,
  bloodPressure: "120 / 80",
  glucose: 104,
  smoking: false,
  hypertensionFamily: true,
  diabetesFamily: false,
  conditions: [],
  conditionStatus: "unknown",
  specialHistory: "",
  pregnancyStatus: "unknown",
  htnStatus: "unknown",
  alcoholDays: null,
  alcoholWeek: null,
  bingeMonthly: null,
  waistCm: null,
  restingHeartRate: null,
  educationYears: null,
  sleepHours: null,
  activeMinutesWeek: null,
  familyHistory: [],
};
// toDev P08 plus common chronic conditions; unlisted/rare histories are free text.
export const chronicConditions = [
  ["hypertension", "고혈압"],
  ["diabetes", "당뇨병"],
  ["dyslipidemia", "이상지질혈증"],
  ["ckd", "만성 콩팥병"],
  ["stroke_tia", "뇌졸중 / 일과성 허혈발작"],
  ["cad_mi", "관상동맥질환 / 심근경색"],
  ["heart_failure", "심부전"],
  ["afib", "심방세동"],
  ["asthma", "천식"],
  ["copd", "만성 폐쇄성 폐질환"],
  ["thyroid", "갑상선 질환"],
  ["arthritis", "관절염"],
  ["osteoporosis", "골다공증"],
  ["chronic_liver", "만성 간질환"],
  ["osa", "수면무호흡증"],
  ["parkinson", "파킨슨병"],
] as const;
export function conditionLabel(code: string) {
  return chronicConditions.find(([key]) => key === code)?.[1] ?? code;
}
export function bmi(height: number, weight: number) {
  return height > 0 && weight > 0 ? (weight / (height / 100) ** 2).toFixed(1) : "—";
}
