import { describe, expect, it } from "vitest";
import { bmi, initialProfile, profileSchema } from "./profile";
describe("profile inputs", () => {
  it("calculates BMI from metric inputs", () => {
    expect(bmi(165, 68)).toBe("25.0");
    expect(bmi(0, 68)).toBe("—");
  });
  it("accepts the sample and rejects invalid inputs", () => {
    expect(profileSchema.safeParse(initialProfile).success).toBe(true);
    expect(profileSchema.safeParse({ ...initialProfile, height: 0 }).success).toBe(false);
    expect(profileSchema.safeParse({ ...initialProfile, bloodPressure: "wrong" }).success).toBe(
      false,
    );
  });
  it("preserves unknown measurements and choices without converting them to zero or false", () => {
    const unknown = {
      bloodPressure: null,
      glucose: null,
      smoking: null,
      hypertensionFamily: null,
      diabetesFamily: null,
    };
    expect(profileSchema.parse({ ...initialProfile, ...unknown })).toEqual({
      ...initialProfile,
      ...unknown,
    });
    for (const key of Object.keys(unknown)) {
      expect(profileSchema.parse({ ...initialProfile, [key]: null })).toEqual({
        ...initialProfile,
        [key]: null,
      });
    }
  });
  it("still rejects invalid known values when another measurement is unknown", () => {
    for (const glucose of ["", 0, -1, 1001, NaN]) {
      expect(
        profileSchema.safeParse({ ...initialProfile, bloodPressure: null, glucose }).success,
      ).toBe(false);
    }
    for (const bloodPressure of ["", "120", "wrong"]) {
      expect(
        profileSchema.safeParse({ ...initialProfile, bloodPressure, glucose: null }).success,
      ).toBe(false);
    }
  });
});
