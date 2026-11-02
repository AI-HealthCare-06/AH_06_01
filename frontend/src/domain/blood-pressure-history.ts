import { z } from "zod";
import type { DailySurvey } from "./daily-survey";
export const pressureDate = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const timestamp = z
  .string()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value)),
    "측정 시각을 확인해 주세요.",
  );
export const pressureMetadataSchema = z
  .object({
    timePrecision: z.enum(["minute", "day"]),
    measuredAt: timestamp.nullable(),
    setting: z.enum(["home", "clinic", "unknown"]),
    method: z.enum(["upper-arm-cuff", "wrist", "other", "unknown"]),
    deviceLabel: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((v) => !v.includes("\u0000"))
      .nullable(),
    protocolConfirmed: z.boolean().nullable(),
  })
  .strict()
  .refine(
    (v) => (v.timePrecision === "minute") === (v.measuredAt !== null),
    "시각을 모르면 시각 모름을 선택해 주세요.",
  );
export type PressureMetadata = z.infer<typeof pressureMetadataSchema>;
export const unknownPressureMetadata = (): PressureMetadata => ({
  timePrecision: "day",
  measuredAt: null,
  setting: "unknown",
  method: "unknown",
  deviceLabel: null,
  protocolConfirmed: null,
});
export const pressureDetailsSchema = z
  .object({
    morning: pressureMetadataSchema.nullable(),
    evening: pressureMetadataSchema.nullable(),
  })
  .strict();
const realDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + "T12:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });
export const pressureValueSchema = z
  .object({
    recorded_on: realDay,
    slot: z.enum(["morning", "evening"]),
    status: z.enum(["measured", "deleted"]),
    systolic: z.number().int().min(10).max(999).nullable(),
    diastolic: z.number().int().min(10).max(999).nullable(),
    unit: z.literal("mmHg"),
    source: z.enum(["manual-survey", "legacy-survey"]),
    metadata: pressureMetadataSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.status === "measured"
        ? v.systolic === null || v.diastolic === null || v.systolic <= v.diastolic
        : v.systolic !== null || v.diastolic !== null
    )
      ctx.addIssue({ code: "custom", message: "혈압과 측정 상태가 맞지 않아요." });
    if (v.metadata.measuredAt && pressureDate(new Date(v.metadata.measuredAt)) !== v.recorded_on)
      ctx.addIssue({ code: "custom", message: "혈압 측정 날짜가 맞지 않아요." });
    if (
      v.source === "legacy-survey" &&
      JSON.stringify(v.metadata) !== JSON.stringify(unknownPressureMetadata())
    )
      ctx.addIssue({ code: "custom", message: "이전 기록의 측정 정보를 임의로 만들 수 없어요." });
  });
export const pressureMutationSchema = z
  .object({
    mutation_id: z.uuid(),
    entry_key: z.string().regex(/^survey:\d{4}-\d{2}-\d{2}:(morning|evening)$/),
    parent_mutation_id: z.uuid().nullable(),
    value: pressureValueSchema,
  })
  .strict()
  .refine(
    (v) => v.entry_key === `survey:${v.value.recorded_on}:${v.value.slot}`,
    "측정 기록 키가 맞지 않아요.",
  );
export type PressureMutation = z.infer<typeof pressureMutationSchema>;
export const pressureRevisionSchema = z
  .object({
    command: pressureMutationSchema,
    revision: z.number().int().positive().nullable(),
    available_at: timestamp.nullable(),
  })
  .strict()
  .refine(
    (v) => (v.revision === null) === (v.available_at === null),
    "서버 저장 상태가 맞지 않아요.",
  );
export type PressureRevision = z.infer<typeof pressureRevisionSchema>;

export function pressureHeads(records: PressureRevision[]) {
  const parents = new Set(records.map((r) => r.command.parent_mutation_id).filter(Boolean));
  return new Map(
    records
      .filter((r) => !parents.has(r.command.mutation_id))
      .map((r) => [r.command.entry_key, r.command]),
  );
}

export type PressureDraftBase = {
  owner: string;
  date: string;
  morning: string | null;
  evening: string | null;
};
export function pressureDraftBase(
  owner: string,
  records: PressureRevision[],
  date: string,
): PressureDraftBase {
  const heads = pressureHeads(records);
  return {
    owner,
    date,
    morning: heads.get(`survey:${date}:morning`)?.mutation_id ?? null,
    evening: heads.get(`survey:${date}:evening`)?.mutation_id ?? null,
  };
}

// The journal may be newer than the compatibility game snapshot. A new form
// must show its latest values, including deletions, rather than resurrect old BP.
export function pressureSurveySnapshot(
  records: PressureRevision[],
  date: string,
  saved?: DailySurvey,
) {
  const heads = pressureHeads(records);
  const slot = (key: "morning" | "evening") => {
    const head = heads.get(`survey:${date}:${key}`)?.value;
    return head
      ? head.status === "measured"
        ? {
            pair: { systolic: head.systolic!, diastolic: head.diastolic! },
            metadata: head.metadata,
          }
        : { pair: null, metadata: unknownPressureMetadata() }
      : {
          pair: saved?.bloodPressureStatus === "measured" ? saved[key] : null,
          metadata: saved?.bloodPressureDetails?.[key] ?? unknownPressureMetadata(),
        };
  };
  const morning = slot("morning"),
    evening = slot("evening");
  return {
    morning: morning.pair,
    evening: evening.pair,
    metadata: { morning: morning.metadata, evening: evening.metadata },
    status:
      morning.pair || evening.pair
        ? "measured"
        : heads.has(`survey:${date}:morning`) || heads.has(`survey:${date}:evening`)
          ? "not-measured"
          : (saved?.bloodPressureStatus ?? ""),
  };
}

export function surveyPressureMutations(
  records: PressureRevision[],
  survey: DailySurvey,
  uuid: () => string = () => crypto.randomUUID(),
): PressureMutation[] {
  const heads = pressureHeads(records);
  const result: PressureMutation[] = [];
  for (const slot of ["morning", "evening"] as const) {
    const entry_key = `survey:${survey.date}:${slot}`;
    const prior = heads.get(entry_key);
    const pair = survey.bloodPressureStatus === "measured" ? survey[slot] : null;
    if (!pair && (!prior || prior.value.status === "deleted")) continue;
    const details = pair ? survey.bloodPressureDetails?.[slot] : null;
    const value = pressureValueSchema.parse({
      recorded_on: survey.date,
      slot,
      status: pair ? "measured" : "deleted",
      systolic: pair?.systolic ?? null,
      diastolic: pair?.diastolic ?? null,
      unit: "mmHg",
      source: details ? "manual-survey" : "legacy-survey",
      metadata: details ?? unknownPressureMetadata(),
    });
    if (prior && JSON.stringify(prior.value) === JSON.stringify(value)) continue;
    result.push(
      pressureMutationSchema.parse({
        mutation_id: uuid(),
        entry_key,
        parent_mutation_id: prior?.mutation_id ?? null,
        value,
      }),
    );
  }
  return result;
}

export function mergePressureHeads(
  local: PressureRevision[],
  remote: PressureRevision[],
): PressureRevision[] {
  const records = new Map(local.map((r) => [r.command.mutation_id, r]));
  for (const revision of remote) {
    const prior = records.get(revision.command.mutation_id);
    if (prior && JSON.stringify(prior.command) !== JSON.stringify(revision.command))
      throw new Error("BP_REVISION_CONFLICT");
    records.set(revision.command.mutation_id, revision);
  }
  // Pending local edits stay after the acknowledged server head. A concurrent
  // branch is preserved and rejected explicitly by the append RPC, never rebased silently.
  return [...records.values()].sort((a, b) => {
    if (a.revision === null || b.revision === null)
      return a.revision === null ? (b.revision === null ? 0 : 1) : -1;
    return a.command.entry_key.localeCompare(b.command.entry_key) || a.revision - b.revision;
  });
}
