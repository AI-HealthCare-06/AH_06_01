import { describe, expect, it } from "vitest";
import { bloodPressureEntry } from "./blood-pressure-entry";

describe("a manually entered blood pressure pair", () => {
  it("normalizes the measured pair without interpreting a medical category", () => {
    expect(bloodPressureEntry("123", "78")).toBe("123 / 78");
  });
  it.each([
    ["", "80"],
    ["120", ""],
    ["120.5", "80"],
    ["120", "-1"],
    ["0", "0"],
    ["80", "120"],
    ["80", "80"],
    ["1200", "80"],
  ])("rejects malformed or reversed values %s / %s", (s, d) => {
    expect(bloodPressureEntry(s, d)).toBeNull();
  });
});
