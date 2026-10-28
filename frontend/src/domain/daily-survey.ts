import { z } from "zod";
import { localDate } from "./calendar";
export function sleepHoursFromTimes(
  bedtime: string | null | undefined,
  wakeTime: string | null | undefined,
) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!bedtime || !wakeTime || !time.test(bedtime) || !time.test(wakeTime)) return null;
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const duration = (minutes(wakeTime) - minutes(bedtime) + 1440) % 1440;
  return duration === 0 ? null : duration / 60;
}
const bp = z
  .object({
    systolic: z.number().int().min(10).max(999),
    diastolic: z.number().int().min(10).max(999),
  })
  .refine((v) => v.systolic > v.diastolic, "수축기 혈압은 이완기보다 커야 해요.");
export const dailySurveySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    submittedAt: z.number().finite().nonnegative(),
    bloodPressureStatus: z.enum(["measured", "not-measured"]),
    morning: bp.nullable(),
    evening: bp.nullable(),
    pulseStatus: z.enum(["measured", "not-measured"]),
    restingHr: z.number().int().min(20).max(250).nullable(),
    sleepStatus: z.enum(["reported", "unknown"]),
    sleepInputKind: z.enum(["duration", "times"]).optional(),
    bedtime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
    wakeTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
    snoringScore: z.number().int().min(0).max(10).nullable().optional(),
    daytimeSleepinessScore: z.number().int().min(0).max(10).nullable().optional(),
    sleepHours: z.number().min(0).max(24).nullable(),
    fastingGlucose: z.number().min(20).max(1000).nullable(),
    activeMinutes: z.number().int().min(0).max(1440).nullable(),
    sedentaryHours: z.number().min(0).max(24).nullable(),
    snoring: z.boolean().nullable(),
    daytimeSleepiness: z.boolean().nullable(),
    nocturia: z.boolean().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.sleepInputKind === "times") {
      const duration = sleepHoursFromTimes(v.bedtime, v.wakeTime);
      if (
        v.sleepStatus === "reported" &&
        (duration === null || v.sleepHours === null || Math.abs(duration - v.sleepHours) > 1 / 3600)
      )
        ctx.addIssue({
          code: "custom",
          path: ["sleepHours"],
          message: "취침·기상 시각을 모두 확인해 주세요. 같은 시각은 입력할 수 없어요.",
        });
      if (
        v.sleepStatus === "unknown" &&
        (typeof v.bedtime === "string" || typeof v.wakeTime === "string")
      )
        ctx.addIssue({
          code: "custom",
          path: ["sleepHours"],
          message: "수면 시각을 모르겠다면 비워 주세요.",
        });
    }
    for (const [key, score, flag] of [
      ["snoringScore", v.snoringScore, v.snoring],
      ["daytimeSleepinessScore", v.daytimeSleepinessScore, v.daytimeSleepiness],
    ] as const) {
      if (typeof score === "number" && flag !== score > 0)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "수면 증상 점수와 응답을 확인해 주세요.",
        });
    }
    if ((v.bloodPressureStatus === "measured") !== Boolean(v.morning || v.evening))
      ctx.addIssue({
        code: "custom",
        path: ["bloodPressureStatus"],
        message: "측정한 혈압 또는 미측정을 선택해 주세요.",
      });
    if ((v.pulseStatus === "measured") !== (v.restingHr !== null))
      ctx.addIssue({
        code: "custom",
        path: ["pulseStatus"],
        message: "측정한 맥박 또는 미측정을 선택해 주세요.",
      });
    if ((v.sleepStatus === "reported") !== (v.sleepHours !== null))
      ctx.addIssue({
        code: "custom",
        path: ["sleepStatus"],
        message: "수면 시간 또는 모름을 선택해 주세요.",
      });
  });
export type DailySurvey = z.infer<typeof dailySurveySchema>;
export function latestSurveyPressure(survey: DailySurvey) {
  return survey.evening ?? survey.morning;
}
export function validDailySurvey(value: unknown, date: string, now = Date.now()) {
  const parsed = dailySurveySchema.safeParse(value);
  return parsed.success &&
    parsed.data.date === date &&
    localDate(new Date(parsed.data.submittedAt)) === date &&
    parsed.data.submittedAt <= now
    ? parsed.data
    : null;
}
