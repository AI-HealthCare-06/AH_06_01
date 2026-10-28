import { describe, expect, it } from "vitest";
import { healthProfilePayload } from "./health-profile-payload";
import { initialProfile } from "../domain/profile";
describe("toDev input mapping", () => {
  it("preserves rare histories and unknown values without pretending a raw BP is an average", () => {
    const payload = healthProfilePayload(
      {
        ...initialProfile,
        bloodPressure: null,
        glucose: null,
        smoking: null,
        conditions: ["ckd", "희귀 유전병"],
        specialHistory: "주치의 주의사항",
      },
      [],
    );
    expect(payload.comorbidity_codes).toEqual(["ckd"]);
    expect(payload.rare_condition_names).toEqual(["희귀 유전병"]);
    expect(payload.special_history).toBe("주치의 주의사항");
    expect(payload.fasting_glucose).toBeNull();
    expect(payload.smoking_current).toBeNull();
    expect(payload.htn_status).toBeNull();
    expect(payload).not.toHaveProperty("home_sbp_avg_7d");
  });
  it("keeps explicit none, false and zero distinct from unanswered reference inputs", () => {
    const payload = healthProfilePayload(
      {
        ...initialProfile,
        conditionStatus: "none",
        hypertensionFamily: false,
        diabetesFamily: false,
        alcoholDays: 0,
        educationYears: 0,
        waistCm: 85,
        restingHeartRate: 65,
      },
      [],
    );
    expect(payload).toMatchObject({
      condition_status: "none",
      family_history_codes: [],
      alcohol_week: 0,
      binge: false,
      education_years: 0,
      waist_cm: 85,
      resting_hr: 65,
    });
    expect(healthProfilePayload(initialProfile, [])).toMatchObject({
      condition_status: "unknown",
      alcohol_week: null,
      binge: null,
      waist_cm: null,
      resting_hr: null,
      education_years: null,
    });
  });
});
