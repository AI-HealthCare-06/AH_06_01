import { describe, expect, it } from "vitest";
import { bpStageSchema, bpStagePresentation, healthSnapshotKey } from "./bp-stage";
import { initialProfile } from "./profile";

const sample = {
  stage_probs: { normal: 0.1744, elevated: 0.0901, prehtn: 0.4187, htn: 0.3168 },
  stage_top: "prehtn",
  risk_level: "prehtn",
  reason_codes: ["alcohol_high", "family_htn"],
  data_quality: "ok",
  model_version: "M1-20261020_150607-nested__base",
  feature_version: "1.2.0",
};
describe("M1-S response contract", () => {
  it("presents a positive screening flag as a BP check without changing stage probabilities", () => {
    const result = bpStageSchema.parse({
      ...sample,
      htn_screening: {
        positive: true,
        probability: sample.stage_probs.htn,
        threshold: 0.12143345115658617,
        policy_id: "htn-screen-v1",
      },
    });
    expect(bpStagePresentation(result).label).toBe("혈압 확인 권고");
    expect(bpStagePresentation(result).description).toContain("고혈압 판정이 아니며");
    expect(result.stage_top).toBe("prehtn");
    expect(result.stage_probs).toEqual(sample.stage_probs);
    expect(bpStageSchema.safeParse({ ...result, data_quality: "not_applicable" }).success).toBe(
      false,
    );
    expect(
      bpStageSchema.safeParse({
        ...result,
        htn_screening: { ...result.htn_screening, positive: false },
      }).success,
    ).toBe(false);
  });
  it("does not present below-threshold screening as an exclusion of hypertension", () => {
    const result = bpStageSchema.parse({
      ...sample,
      htn_screening: {
        positive: false,
        probability: sample.stage_probs.htn,
        threshold: 0.4,
        policy_id: "test",
      },
    });
    expect(bpStagePresentation(result).description).toContain("고혈압이 없다는 뜻은 아니에요");
  });
  it("keeps the returned stage even when it is not the maximum probability", () => {
    const result = bpStageSchema.parse({ ...sample, stage_top: "normal", risk_level: "normal" });
    expect(bpStagePresentation(result).label).toBe("정상 참고권");
    expect(result.stage_probs?.htn).toBe(0.3168);
  });
  it("rejects probability sums, unknown levels and incompatible result states", () => {
    for (const result of [
      { ...sample, stage_probs: { normal: 1, elevated: 1, prehtn: 1, htn: 1 } },
      { ...sample, risk_level: "high" },
      { ...sample, data_quality: "insufficient" },
      { ...sample, risk_level: "normal" },
    ])
      expect(bpStageSchema.safeParse(result).success).toBe(false);
  });
  it("renders domain refusal as input guidance with no score", () => {
    const result = bpStageSchema.parse({
      ...sample,
      stage_probs: null,
      stage_top: null,
      risk_level: null,
      reason_codes: [],
      data_quality: "not_applicable",
      problems: "bp_input_present:sbp",
    });
    expect(bpStagePresentation(result).label).toContain("혈압 기록");
    expect(result.stage_probs).toBeNull();
  });
  it("does not treat game/identity/cosmetic edits as new health analysis", () => {
    expect(healthSnapshotKey(initialProfile)).toBe(
      healthSnapshotKey({ ...initialProfile, name: "다른 이름", specialHistory: "이력" }),
    );
    expect(healthSnapshotKey(initialProfile)).not.toBe(
      healthSnapshotKey({ ...initialProfile, bloodPressure: null }),
    );
    expect(healthSnapshotKey(initialProfile)).not.toBe(
      healthSnapshotKey({ ...initialProfile, smoking: !initialProfile.smoking }),
    );
    expect(healthSnapshotKey()).toBeNull();
  });
});
