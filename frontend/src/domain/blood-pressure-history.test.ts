import { describe, expect, it } from "vitest";
import { dailySurveySchema } from "./daily-survey";
import { surveyFixture } from "./daily-survey.test-fixture";
import {
  mergePressureHeads,
  pressureMutationSchema,
  pressureHeads,
  pressureSurveySnapshot,
  surveyPressureMutations,
  unknownPressureMetadata,
  type PressureRevision,
} from "./blood-pressure-history";
const date = "2026-11-02";
const survey = () =>
  dailySurveySchema.parse({
    ...surveyFixture(date),
    submittedAt: Date.parse(date + "T21:00:00+09:00"),
    bloodPressureStatus: "measured",
    morning: { systolic: 148, diastolic: 94 },
    evening: { systolic: 142, diastolic: 90 },
  });
const local = (commands: ReturnType<typeof surveyPressureMutations>): PressureRevision[] =>
  commands.map((command) => ({ command, revision: null, available_at: null }));
describe("immutable blood pressure commands", () => {
  it("keeps unknown legacy metadata unknown and never invents receipt timestamps", () => {
    const records = local(surveyPressureMutations([], survey()));
    expect(records).toHaveLength(2);
    expect(records[0].command.value.source).toBe("legacy-survey");
    expect(records[0].command.value.metadata).toEqual(unknownPressureMetadata());
    expect(records[0].available_at).toBeNull();
    expect(surveyPressureMutations(records, { ...survey(), sleepHours: 7 })).toEqual([]);
  });
  it("appends corrections and deletions to the same branch without replacing the original", () => {
    const records = local(surveyPressureMutations([], survey()));
    const change = surveyPressureMutations(records, {
      ...survey(),
      morning: { systolic: 144, diastolic: 92 },
      evening: null,
    });
    expect(change).toHaveLength(2);
    expect(change[0].parent_mutation_id).toBe(records[0].command.mutation_id);
    expect(change[1].value.status).toBe("deleted");
    expect(change[1].value.systolic).toBeNull();
    expect(records[0].command.value.systolic).toBe(148);
  });
  it("validates measurement dates, future clocks and minute precision without making metadata mandatory", () => {
    const meta = {
      ...unknownPressureMetadata(),
      timePrecision: "minute",
      measuredAt: date + "T08:00:00+09:00",
      setting: "home",
      method: "upper-arm-cuff",
      deviceLabel: "집 혈압계",
      protocolConfirmed: true,
    } as const;
    const details = { morning: meta, evening: null };
    const valid = dailySurveySchema.parse({ ...survey(), bloodPressureDetails: details });
    expect(surveyPressureMutations([], valid)[0].value.metadata.measuredAt).toBe(meta.measuredAt);
    for (const patch of [
      { measuredAt: "2026-11-01T08:00:00+09:00" },
      { measuredAt: date + "T22:00:00+09:00" },
      { measuredAt: null },
      { measuredAt: date + "T08:00:00" },
    ]) {
      expect(
        dailySurveySchema.safeParse({
          ...survey(),
          bloodPressureDetails: { ...details, morning: { ...meta, ...patch } },
        }).success,
      ).toBe(false);
    }
    expect(dailySurveySchema.safeParse(survey()).success).toBe(true);
  });
  it("upgrades a lost acknowledgment and chooses the descendant head rather than its pending ancestor", () => {
    const first = local(surveyPressureMutations([], survey()));
    const next = surveyPressureMutations(first, {
      ...survey(),
      morning: { systolic: 140, diastolic: 88 },
    })[0];
    const remote = [{ command: next, revision: 2, available_at: "2026-11-02T13:00:00.123456Z" }];
    const merged = mergePressureHeads(first, remote);
    expect(pressureHeads(merged).get(next.entry_key)?.mutation_id).toBe(next.mutation_id);
    const edited = surveyPressureMutations(merged, {
      ...survey(),
      morning: { systolic: 138, diastolic: 86 },
    });
    expect(edited[0].parent_mutation_id).toBe(next.mutation_id);
    const same = mergePressureHeads(first, [
      { ...first[0], revision: 1, available_at: "2026-11-02T13:00:00Z" },
    ]);
    expect(same.find((r) => r.command.mutation_id === first[0].command.mutation_id)?.revision).toBe(
      1,
    );
  });
  it("rejects client-supplied server fields and conflicting immutable payloads", () => {
    const first = local(surveyPressureMutations([], survey()));
    expect(
      pressureMutationSchema.safeParse({
        ...first[0].command,
        available_at: "2000-01-01T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(() =>
      mergePressureHeads(first, [
        {
          ...first[0],
          command: { ...first[0].command, value: { ...first[0].command.value, systolic: 150 } },
        },
      ]),
    ).toThrow("BP_REVISION_CONFLICT");
  });
  it("uses newer journal values and tombstones instead of a stale compatibility survey", () => {
    const first = local(surveyPressureMutations([], survey()));
    const changes = local(
      surveyPressureMutations(first, {
        ...survey(),
        morning: { systolic: 136, diastolic: 84 },
        evening: null,
      }),
    );
    const draft = pressureSurveySnapshot([...first, ...changes], date, survey());
    expect(draft.morning).toEqual({ systolic: 136, diastolic: 84 });
    expect(draft.evening).toBeNull();
    expect(draft.status).toBe("measured");
  });
});
