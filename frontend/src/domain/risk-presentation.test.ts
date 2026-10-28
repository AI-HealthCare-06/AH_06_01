import { describe, expect, it } from "vitest";
import {
  bloodPressurePresentation,
  modelPresentation,
  rankerPresentation,
} from "./risk-presentation";
describe("source-defined result presentation", () => {
  it("does not turn one measurement, missing data, or an unknown code into a reassuring grade", () => {
    expect(bloodPressurePresentation({ sbp: 120, dbp: 80 }).result).toBeNull();
    expect(bloodPressurePresentation({ bp_band: "normal", valid_days_7d: 4 }).label).toContain(
      "보류",
    );
    expect(bloodPressurePresentation({ bp_band: "unexpected" }).tone).toBe("neutral");
    expect(bloodPressurePresentation(null).result).toBeNull();
  });
  it("honors the safety gate before reference bands and supports source aliases", () => {
    expect(
      bloodPressurePresentation({ bp_band: "normal_ref", crisis_level: "emergency_119" }).label,
    ).toBe("응급 안내");
    expect(bloodPressurePresentation({ bp_band: "normal_ref", valid_days_7d: 7 }).label).toBe(
      "정상 참고권",
    );
    expect(bloodPressurePresentation({ bp_band: "prehtn_ref" }).label).toBe("전단계 참고권");
  });
  it("preserves the model's returned level rather than inventing probability boundaries", () => {
    const result = {
      calibrated_p: 0.8,
      risk_index: 80,
      risk_level: "moderate",
      model_id: "test",
      model_version: "v1",
      data_quality: "valid",
    };
    expect(modelPresentation(result)).toMatchObject({ label: "중간 · 모델 참고", value: 80 });
    expect(modelPresentation({ ...result, calibrated_p: null }).value).toBeNull();
    expect(modelPresentation({ ...result, calibrated_p: 1.1 }).value).toBeNull();
  });
  it("orders ranker priorities without mutating the result or treating rank as a health score", () => {
    const input = [
      { quest_id: "walk", priority: 2, reason: "걷기" },
      { quest_id: "measure", priority: 1, reason: "측정" },
    ];
    expect(rankerPresentation(input).map((item) => item.quest_id)).toEqual(["measure", "walk"]);
    expect(input[0].priority).toBe(2);
    expect(rankerPresentation([{ quest_id: "walk", priority: -1, reason: "" }])).toEqual([]);
  });
});
