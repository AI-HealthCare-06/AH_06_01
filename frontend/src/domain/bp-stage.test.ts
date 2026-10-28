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
    expect(healthSnapshotKey()).toBeNull();
  });
});
