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
});
