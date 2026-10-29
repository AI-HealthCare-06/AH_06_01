import { describe, it, expect } from "vitest";
import {
  classifySequence,
  resampleSequence,
  sequenceDistance,
  sequenceFeatureCount,
  sequenceModelSchema,
  type SequenceFrame,
} from "./sequence";
import { toolManifestSchema } from "./tools";
const clip = (times: number[], reverse = false): SequenceFrame[] =>
  times.map((t) => ({
    t,
    values: Array.from({ length: sequenceFeatureCount }, () => (reverse ? 1 - t / 3100 : t / 3100)),
  }));
describe("supervised sequence classifier", () => {
  it("normalizes irregular frame cadence while preserving action order", () => {
    const a = resampleSequence(clip([0, 100, 1500, 3100]));
    const b = resampleSequence(clip(Array.from({ length: 32 }, (_, i) => i * 100)));
    expect(sequenceDistance(a, b)).toBeLessThan(1e-12);
    expect(
      sequenceDistance(a, resampleSequence(clip([0, 1000, 2000, 3100], true))),
    ).toBeGreaterThan(0.1);
  });
  it("rejects negative actions, insufficient clips and fabricated training metadata", () => {
    const times = Array.from({ length: 32 }, (_, i) => i * 100);
    const model = sequenceModelSchema.parse({
      schemaVersion: 1,
      featureVersion: "motion-sequence-v2",
      training: {
        synthetic: false,
        trainSubjects: 2,
        evaluationSubjects: 1,
        evaluationClips: 5,
        macroF1: 0.9,
        minPositivePrecision: 0.95,
      },
      prototypes: [
        { label: "water", values: resampleSequence(clip(times)) },
        { label: "negative", values: resampleSequence(clip(times, true)) },
      ],
      thresholds: Object.fromEntries(
        ["water", "oral", "insulin_pen", "syringe", "negative"].map((k) => [
          k,
          { maxDistance: 0.05, minMargin: 0.02 },
        ]),
      ),
    });
    expect(classifySequence(model, clip(times), "water").accepted).toBe(true);
    expect(classifySequence(model, clip(times, true), "water").accepted).toBe(false);
    expect(classifySequence(model, clip(times.slice(0, 10)), "water").accepted).toBe(false);
    expect(
      sequenceModelSchema.safeParse({ ...model, training: { ...model.training, synthetic: true } })
        .success,
    ).toBe(false);
    expect(
      sequenceModelSchema.safeParse({ ...model, training: { ...model.training, macroF1: 0.5 } })
        .success,
    ).toBe(false);
  });
  it("does not accept an untrained tool manifest or traversal path", () => {
    expect(toolManifestSchema.safeParse({ schemaVersion: 1, validated: false }).success).toBe(
      false,
    );
    const config = {
      schemaVersion: 1,
      validated: true,
      file: "tool-good.tflite",
      sha256: "a".repeat(64),
      labels: ["pill", "insulin_pen", "syringe"],
      evaluation: { trainSubjects: 2, evaluationSubjects: 1, images: 20, AP: 0.7 },
    };
    expect(toolManifestSchema.safeParse(config).success).toBe(true);
    expect(toolManifestSchema.safeParse({ ...config, file: "../other.tflite" }).success).toBe(
      false,
    );
  });
});
