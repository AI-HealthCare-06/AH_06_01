import { describe, expect, it } from "vitest";
import { initialGame } from "./game";
import { createDemoGame } from "./demo-persona";
import { quarterDemoPersona } from "./demo-personas";
import type { BpStageResult } from "./bp-stage";
import {
  approvedLifestyleResult,
  dashboardPressure,
  pressureChange,
  pressureDays,
  profilePressure,
} from "./dashboard-pressure";

describe("measurement-first dashboard pressure analysis", () => {
  it("uses both daily measurements, preserves the latest raw reading and weights each day equally", () => {
    const game = createDemoGame(
      "2026-11-02",
      Date.parse("2026-11-02T12:00:00Z"),
      quarterDemoPersona,
    );
    const day = game.dailySurveys[game.date];
    game.dailySurveys = {
      "2026-11-01": {
        ...day,
        date: "2026-11-01",
        morning: { systolic: 150, diastolic: 90 },
        evening: null,
      },
      "2026-11-02": {
        ...day,
        morning: { systolic: 130, diastolic: 80 },
        evening: { systolic: 120, diastolic: 70 },
      },
    };
    game.healthHistory = {};
    const result = dashboardPressure(game, "week", game.date);
    expect(result.mode).toBe("measured");
    expect(result.readingCount).toBe(3);
    expect(result.days.map((d) => d.systolic)).toEqual([150, 125]);
    expect(result.average).toEqual({ systolic: 137.5, diastolic: 82.5 });
    expect(result.latest).toMatchObject({ systolic: 120, diastolic: 70, slot: "저녁" });
    expect(result.trend).toMatchObject({ systolic: -25, diastolic: -15 });
    expect(dashboardPressure(game, "day", game.date).trend).toMatchObject({
      systolic: -10,
      diastolic: -10,
      comparison: "같은 날 아침 → 저녁",
    });
  });

  it("does not resurrect explicitly unmeasured, invalid, mismatched or future records", () => {
    const game = createDemoGame(
      "2026-11-02",
      Date.parse("2026-11-02T12:00:00Z"),
      quarterDemoPersona,
    );
    const survey = game.dailySurveys[game.date];
    game.healthHistory = {
      "2026-11-01": { steps: null, sleepHours: null, systolic: 150, diastolic: 90 },
      "2026-11-02": { steps: null, sleepHours: null, systolic: 0, diastolic: 0 },
      "2026-11-03": { steps: null, sleepHours: null, systolic: 140, diastolic: 80 },
      "2026-02-30": { steps: null, sleepHours: null, systolic: 140, diastolic: 80 },
    };
    game.dailySurveys = {
      "2026-11-01": {
        ...survey,
        date: "2026-11-01",
        bloodPressureStatus: "not-measured",
        morning: null,
        evening: null,
      },
    };
    expect(pressureDays(game)).toEqual([]);
    expect(dashboardPressure(game, "week", game.date).mode).toBe("lifestyle");
    game.dailySurveys["2026-11-01"] = survey; // mismatched date must not fall back to stale history
    expect(pressureDays(game)).toEqual([]);
    game.dailySurveys = {};
    expect(pressureDays(game)).toHaveLength(1);
  });

  it("keeps out-of-period measurements separate and never presents future readings as the selected period", () => {
    const game = initialGame("2026-11-02");
    game.healthHistory = {
      "2026-10-01": { steps: null, sleepHours: null, systolic: 130, diastolic: 80 },
      "2026-11-02": { steps: null, sleepHours: null, systolic: 140, diastolic: 90 },
    };
    const result = dashboardPressure(game, "day", "2026-10-15");
    expect(result.mode).toBe("measured");
    expect(result.latest).toBeNull();
    expect(result.average).toBeNull();
    expect(result.trend).toBeNull();
    expect(result.previous?.date).toBe("2026-10-01");
    expect(dashboardPressure(game, "day", "2026-09-01").previous).toBeNull();
    expect(dashboardPressure(game, "custom", game.date, "2026-10-02").days).toHaveLength(1);
  });

  it("shows undated profile input without mixing it into period statistics or treating an unwritten default as a reading", () => {
    const game = initialGame("2026-11-02");
    expect(dashboardPressure(game, "week", game.date).mode).toBe("lifestyle");
    const result = dashboardPressure(game, "week", game.date, undefined, "151 / 96");
    expect(result.mode).toBe("measured");
    expect(result.undated).toEqual({ systolic: 151, diastolic: 96 });
    expect(result.average).toBeNull();
    expect(result.trend).toBeNull();
    expect(result.readingCount).toBe(0);
    for (const value of [null, "", "120/150", "NaN / 80", "120 / 0"])
      expect(profilePressure(value)).toBeNull();
  });

  it("verifies all 90 video-demo days independently and compares nonoverlapping first/last weeks", () => {
    const game = createDemoGame(
      "2026-11-02",
      Date.parse("2026-11-02T12:00:00Z"),
      quarterDemoPersona,
    );
    const result = dashboardPressure(game, "quarter", game.date, undefined, "151 / 96");
    const means = quarterDemoPersona.records.map((r) => ({
      systolic: (r.systolic + r.evening!.systolic) / 2,
      diastolic: (r.diastolic + r.evening!.diastolic) / 2,
    }));
    const average = (rows: typeof means, key: "systolic" | "diastolic") =>
      rows.reduce((s, r) => s + r[key], 0) / rows.length;
    expect(result.days).toHaveLength(90);
    expect(result.readingCount).toBe(180);
    expect(result.latest).toMatchObject({ date: game.date, systolic: 134, diastolic: 87 });
    expect(result.average?.systolic).toBeCloseTo(average(means, "systolic"), 10);
    expect(result.average?.diastolic).toBeCloseTo(average(means, "diastolic"), 10);
    expect(result.trend?.systolic).toBeCloseTo(
      average(means.slice(-7), "systolic") - average(means.slice(0, 7), "systolic"),
      10,
    );
    expect(result.undated).toBeNull();
    expect(dashboardPressure(game, "week", game.date).readingCount).toBe(14);
    expect(dashboardPressure(game, "day", game.date).average).toEqual({
      systolic: 135,
      diastolic: 87.5,
    });
    expect(pressureChange(-0.02)).toBe("변화 없음");
  });

  it("allows only retained M1 results and excludes v9, experimental and unusable responses", () => {
    const base = {
      feature_version: "1.2.0",
      data_quality: "ok",
      model_version: "M1-20261020_150607-nested__base",
    } as BpStageResult;
    expect(approvedLifestyleResult(base)).toBe(true);
    expect(
      approvedLifestyleResult({ ...base, model_version: base.model_version + "-htn-screen-v1" }),
    ).toBe(true);
    for (const version of ["M1-ebm-repair-v9-cost150", "v9", "unknown"])
      expect(approvedLifestyleResult({ ...base, model_version: version })).toBe(false);
    expect(approvedLifestyleResult({ ...base, data_quality: "not_applicable" })).toBe(false);
    expect(approvedLifestyleResult(undefined)).toBe(false);
  });
});
