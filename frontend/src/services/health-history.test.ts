import { describe, expect, it } from "vitest";
import { reportSelection } from "./health-history";

describe("report URL selection", () => {
  it("preserves a selected historical period and range", () => {
    expect(
      reportSelection(
        new URLSearchParams("period=custom&date=2026-10-10&from=2026-10-01"),
        "2026-10-14",
      ),
    ).toEqual({ period: "custom", date: "2026-10-10", from: "2026-10-01" });
  });
  it.each(["2026-02-30", "2026-10-15", "invalid"])(
    "rejects impossible, future or invalid dates: %s",
    (date) => {
      expect(
        reportSelection(
          new URLSearchParams({ period: "unknown", date, from: "2026-11-01" }),
          "2026-10-14",
        ),
      ).toEqual({ period: "week", date: "2026-10-14", from: "2026-10-14" });
    },
  );
});
