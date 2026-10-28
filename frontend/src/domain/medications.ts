import { z } from "zod";

export const drugClasses = {
  arb_acei: "ARB / ACE 억제제",
  ccb: "칼슘채널 차단제",
  diuretic: "이뇨제",
  beta_blocker: "베타 차단제",
  alpha_blocker: "알파 차단제",
  nitrate: "질산염",
  steroid: "스테로이드",
  nsaid: "소염진통제",
  oral_contraceptive: "경구 피임약",
  stimulant: "각성제",
  anti_vegf: "항 VEGF",
  glp1: "GLP-1",
  other: "기타 / 모름",
} as const;
export const medicationSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1, "약 이름을 입력해 주세요.").max(80),
  dose: z.string().trim().max(80).default(""),
  condition: z.string().trim().max(80).default(""),
  drugClass: z
    .enum(
      Object.keys(drugClasses) as [keyof typeof drugClasses, ...Array<keyof typeof drugClasses>],
    )
    .default("other"),
  times: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "복용 시간을 확인해 주세요."))
    .min(1)
    .max(6)
    .refine((times) => new Set(times).size === times.length, "같은 시간을 중복 등록할 수 없어요.")
    .transform((times) => [...times].sort()),
  active: z.boolean().default(true),
});
export type Medication = z.infer<typeof medicationSchema>;
export const medicationListSchema = z.array(medicationSchema).max(12);
export function doseKey(date: string, id: string, time: string) {
  return `${date}|${id}|${time}`;
}
export function dailyDoses(
  medications: Medication[],
  date: string,
  taken: Record<string, boolean>,
) {
  return medications
    .filter((med) => med.active)
    .flatMap((med) =>
      med.times.map((time) => ({
        medication: med,
        time,
        key: doseKey(date, med.id, time),
        taken: !!taken[doseKey(date, med.id, time)],
      })),
    )
    .sort(
      (a, b) => a.time.localeCompare(b.time) || a.medication.name.localeCompare(b.medication.name),
    );
}
