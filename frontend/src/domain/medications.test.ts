import { describe, expect, it } from "vitest";
import { dailyDoses, doseKey, medicationSchema } from "./medications";
const medication = medicationSchema.parse({
  id: "a",
  name: "처방된 약",
  times: ["08:00", "20:00"],
});
describe("daily medication schedules", () => {
  it("normalizes saved and legacy schedules without mutating their original time order", () => {
    const times = ["18:00", "08:00", "12:00", "00:00", "23:59"];
    const parsed = medicationSchema.parse({ ...medication, times });
    expect(parsed.times).toEqual(["00:00", "08:00", "12:00", "18:00", "23:59"]);
    expect(times).toEqual(["18:00", "08:00", "12:00", "00:00", "23:59"]);
  });
  it("rejects invalid and duplicate times and blank medication names", () => {
    for (const times of [["24:00"], ["08:00", "08:00"], []])
      expect(medicationSchema.safeParse({ ...medication, times }).success).toBe(false);
    expect(medicationSchema.safeParse({ ...medication, name: " " }).success).toBe(false);
  });
  it("keeps records separate across medications, times and days and omits inactive schedules", () => {
    const taken = { [doseKey("2026-10-13", "a", "08:00")]: true };
    const doses = dailyDoses(
      [medication, { ...medication, id: "b", active: false }],
      "2026-10-13",
      taken,
    );
    expect(doses.map((dose) => dose.taken)).toEqual([true, false]);
    expect(dailyDoses([medication], "2026-10-14", taken).every((dose) => !dose.taken)).toBe(true);
  });
});
