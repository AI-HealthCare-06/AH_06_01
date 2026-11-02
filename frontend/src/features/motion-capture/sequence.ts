import { z } from "zod";
import { appStorageKey } from "../../domain/demo-mode";
import type { InjectionObservation, InjectionRegion } from "./injection";
import type { ProcessObservation } from "./types";

export const sequenceFeatureVersion = "motion-sequence-v2";
export const sequenceLabels = ["water", "oral", "insulin_pen", "syringe", "negative"] as const;
export type SequenceLabel = (typeof sequenceLabels)[number];
export const sequenceFeatureCount = 23;
const vectorSchema = z.array(z.number().finite().min(0).max(1)).length(sequenceFeatureCount);
export const sequenceFrameSchema = z.object({
  t: z.number().finite().min(0).max(65000),
  values: vectorSchema,
});
export type SequenceFrame = z.infer<typeof sequenceFrameSchema>;
const prototypeSchema = z.object({
  label: z.enum(sequenceLabels),
  values: z.array(vectorSchema).length(32),
});
export const sequenceModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    featureVersion: z.literal(sequenceFeatureVersion),
    training: z.object({
      synthetic: z.literal(false),
      trainSubjects: z.number().int().min(2),
      evaluationSubjects: z.number().int().min(1),
      evaluationClips: z.number().int().min(5),
      macroF1: z.number().min(0.8).max(1),
      minPositivePrecision: z.number().min(0.9).max(1),
    }),
    prototypes: z.array(prototypeSchema).min(2).max(24),
    thresholds: z.record(
      z.enum(sequenceLabels),
      z.object({
        maxDistance: z.number().finite().positive().max(1),
        minMargin: z.number().finite().min(0).max(1),
      }),
    ),
  })
  .refine(
    (model) => model.prototypes.some((p) => p.label === "negative"),
    "음성 사례가 포함된 모델이 필요해요.",
  );
export type SequenceModel = z.infer<typeof sequenceModelSchema>;
const bounded = (value: number | null | undefined, scale = 1, unknown = 1) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value / scale))
    : unknown;

/** Derived signals only: no images, raw landmarks, identity or audio. */
export function sequenceFeatures(
  frame: ProcessObservation,
  injection?: InjectionObservation,
  region?: InjectionRegion | null,
): number[] {
  const hand = frame.hand,
    drink = frame.drink;
  const site = injection?.hands[0];
  const distance =
    site && region && injection
      ? Math.hypot(
          (site.x - region.x) * injection.frameWidth,
          (site.y - region.y) * injection.frameHeight,
        ) / Math.min(injection.frameWidth, injection.frameHeight)
      : null;
  return [
    bounded(hand.distance, 3),
    bounded(drink.distance, 3),
    bounded(hand.pinchRatio),
    Number(drink.objectAtMouth),
    drink.objectEvidence === "detected" ? 1 : drink.objectEvidence === "tracked" ? 0.5 : 0,
    bounded(
      drink.objectObservedAt === null ? null : drink.timestamp - drink.objectObservedAt,
      1000,
    ),
    Number(hand.mouth !== null),
    Number(hand.hand !== null || !!site),
    bounded(distance),
    Number(!!region),
    drink.object?.label === "cup" ? 1 : drink.object?.label === "bottle" ? 0.5 : 0,
    Number(hand.valid || drink.valid),
    ...(["pill", "insulin_pen", "syringe"] as const).map((label) =>
      Math.max(
        0,
        ...(frame.tools?.items.filter((item) => item.label === label).map((item) => item.score) ??
          []),
      ),
    ),
    Number(frame.tools?.modelReady === true),
    bounded(drink.drinkMotion?.handInclination, 180),
    bounded(drink.drinkMotion?.aspect, 3),
    bounded(drink.drinkMotion ? drink.drinkMotion.lift + 1 : null, 2),
    Number(
      drink.drinkMotion?.handInclination !== null &&
        drink.drinkMotion?.handInclination !== undefined,
    ),
    ...(["x", "y", "z"] as const).map((axis) =>
      bounded(drink.drinkMotion?.palmNormal ? (drink.drinkMotion.palmNormal[axis] + 1) / 2 : 0.5),
    ),
  ];
}

export function resampleSequence(frames: SequenceFrame[], count = 32): number[][] {
  if (frames.length < 2) return [];
  const start = frames[0].t,
    end = frames.at(-1)!.t;
  let index = 0;
  return Array.from({ length: count }, (_, i) => {
    const time = start + ((end - start) * i) / (count - 1);
    while (index < frames.length - 2 && frames[index + 1].t < time) index++;
    const a = frames[index],
      b = frames[index + 1];
    const ratio = b.t > a.t ? (time - a.t) / (b.t - a.t) : 0;
    return a.values.map((value, j) => value + (b.values[j] - value) * ratio);
  });
}

export function sequenceDistance(a: number[][], b: number[][]) {
  const n = a.length,
    m = b.length,
    band = 8;
  let previous = Array(m + 1).fill(Infinity) as number[];
  previous[0] = 0;
  for (let i = 1; i <= n; i++) {
    const current = Array(m + 1).fill(Infinity) as number[];
    for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) {
      const cost =
        a[i - 1].reduce((sum, value, k) => sum + Math.abs(value - b[j - 1][k]), 0) /
        sequenceFeatureCount;
      current[j] = cost + Math.min(previous[j], current[j - 1], previous[j - 1]);
    }
    previous = current;
  }
  return previous[m] / Math.max(n, m);
}

export function classifySequence(
  model: SequenceModel,
  frames: SequenceFrame[],
  expected: SequenceLabel,
) {
  if (frames.length < 20 || frames.at(-1)!.t - frames[0].t < 1800)
    return { accepted: false, label: null, distance: null, reason: "동작 특징이 부족해요." };
  const values = resampleSequence(frames);
  const scores = sequenceLabels
    .map((label) => ({
      label,
      distance: Math.min(
        ...model.prototypes
          .filter((p) => p.label === label)
          .map((p) => sequenceDistance(values, p.values)),
      ),
    }))
    .sort((a, b) => a.distance - b.distance);
  const best = scores[0],
    rival = scores.find((s) => s.label !== best.label)!;
  const policy = model.thresholds[expected];
  const accepted =
    best.label === expected &&
    best.distance <= policy.maxDistance &&
    rival.distance - best.distance >= policy.minMargin;
  return {
    accepted,
    label: best.label,
    distance: Number.isFinite(best.distance) ? best.distance : null,
    reason: accepted
      ? "학습된 동작 순서와 일치해요."
      : "학습된 동작과 구분이 불확실해요. 직접 확인해 주세요.",
  };
}

const modelKey = () => appStorageKey("rexrun-motion-sequence-model-v2");
export function loadSequenceModel(): SequenceModel | null {
  try {
    const data = JSON.parse(localStorage.getItem(modelKey()) ?? "null");
    const parsed = sequenceModelSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function saveSequenceModel(data: unknown) {
  const model = sequenceModelSchema.parse(data);
  localStorage.setItem(modelKey(), JSON.stringify(model));
  return model;
}
export function removeSequenceModel() {
  localStorage.removeItem(modelKey());
}
export function sequenceSubjectId() {
  const key = appStorageKey("rexrun-cv-research-subject");
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(key, value);
  }
  return value;
}
