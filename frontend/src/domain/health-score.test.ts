import { describe, expect, it } from "vitest";
import { initialGame, mainQuestIds } from "./game";
import { createDemoGame } from "./demo-persona";
import { healthScorePeriod, scoreChangeText } from "./health-score";

const date = "2026-10-28";
const full = { steps: 6000, sleepHours: 7 };
const half = { steps: 3000, sleepHours: 3.5 };

describe("record-based dashboard score", () => {
  it("changes with live steps, main quests and recorded sleep, without changing rewards", () => {
    const game = {
      ...initialGame(date),
      completed: [...mainQuestIds],
      steps: { date, count: 6000, source: "health-connect" as const, syncedAt: 0 },
      sleepHours: 7,
      healthHistory: { [date]: half },
    };
    const before = structuredClone(game);
    expect(healthScorePeriod(game, "day", date).score).toBe(100);
    const lower = {
      ...game,
      completed: ["meal", "survey"] as typeof game.completed,
      sleepHours: 3.5,
      steps: { ...game.steps, count: 3000 },
    };
    expect(healthScorePeriod(lower, "day", date).score).toBe(50);
    expect(
      healthScorePeriod(
        { ...lower, completed: [...lower.completed, "water", "sleep"] },
        "day",
        date,
      ).score,
    ).toBe(50);
    expect(game).toEqual(before);
  });

  it("shows no score for missing records and preserves explicitly recorded zeroes", () => {
    const game = initialGame(date);
    for (const day of [date, "2026-10-20", "2026-10-29"]) {
      expect(healthScorePeriod(game, "day", day).score).toBeNull();
    }
    const recorded = {
      ...game,
      healthHistory: { "2026-10-20": { steps: 0, sleepHours: null } },
      questHistory: { "2026-10-20": 0 },
    };
    const result = healthScorePeriod(recorded, "day", "2026-10-20");
    expect(result.score).toBe(0);
    expect(result.metrics.map((metric) => metric.percent)).toEqual([0, 0, null]);
    expect(result.recordedDays).toBe(1);
  });

  it("caps daily attainment before averaging, includes only recorded days and respects custom ranges", () => {
    const game = {
      ...initialGame(date),
      healthHistory: {
        "2026-10-20": full,
        "2026-10-21": { steps: 12000, sleepHours: 14 },
        "2026-10-22": { steps: 0, sleepHours: 0 },
        "2026-10-29": full,
      },
      questHistory: { "2026-10-20": 4, "2026-10-21": 4, "2026-10-22": 0 },
    };
    const result = healthScorePeriod(game, "custom", "2026-10-27", "2026-10-21");
    expect(result.score).toBe(50);
    expect(result.metrics.map((metric) => metric.percent)).toEqual([50, 50, 50]);
    expect(result.recordedDays).toBe(2);
    expect(result.points.map((point) => point.score)).toEqual([
      100,
      0,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(healthScorePeriod(game, "week", "2026-10-27").score).toBe(50);
  });

  it("uses survey sleep including explicit unknown, and ignores stale step snapshots", () => {
    const demo = createDemoGame(date, new Date(date + "T12:00:00").getTime());
    const game = {
      ...demo,
      sleepHours: 7,
      steps: { ...demo.steps!, date: "2026-10-27", count: 99999 },
      healthHistory: { [date]: { steps: 3000, sleepHours: 7 } },
      dailySurveys: {
        [date]: { ...demo.dailySurveys[date], sleepStatus: "unknown" as const, sleepHours: null },
      },
    };
    const result = healthScorePeriod(game, "day", date);
    expect(result.metrics[0].percent).toBe(50);
    expect(result.metrics[2].percent).toBeNull();
  });

  it("calculates signed and zero changes from actual preceding periods", () => {
    const game = {
      ...initialGame(date),
      completed: [...mainQuestIds],
      sleepHours: 7,
      steps: { date, count: 6000, source: "health-connect" as const, syncedAt: 0 },
      healthHistory: { "2026-10-27": half },
      questHistory: { "2026-10-27": 2 },
    };
    const result = healthScorePeriod(game, "day", date);
    expect(result.delta).toBe(50);
    expect(scoreChangeText(result, "어제")).toBe("어제 대비 +50점");
    const declining = healthScorePeriod(
      { ...game, completed: [], sleepHours: 0, steps: { ...game.steps, count: 0 } },
      "day",
      date,
    );
    expect(declining.delta).toBe(-50);
    expect(scoreChangeText(declining, "어제")).toBe("어제 대비 -50점");
    expect(
      healthScorePeriod(
        { ...game, healthHistory: { "2026-10-27": full }, questHistory: { "2026-10-27": 4 } },
        "day",
        date,
      ).delta,
    ).toBe(0);
    expect(healthScorePeriod({ ...game, healthHistory: {} }, "day", date).delta).toBeNull();
  });

  it("compares weeks, months and years across calendar boundaries without using future records", () => {
    const game = {
      ...initialGame("2027-01-02"),
      healthHistory: { "2026-12-31": half, "2027-01-01": full },
      questHistory: { "2026-12-31": 2, "2027-01-01": 4 },
    };
    for (const period of ["month", "year"] as const) {
      const result = healthScorePeriod(game, period, "2027-01-02");
      expect(result.score).toBe(100);
      expect(result.delta).toBe(50);
      expect(result.previous.end).toBe("2026-12-31");
    }
    expect(healthScorePeriod(game, "week", "2027-01-02").previous).toEqual({
      start: "2026-12-20",
      end: "2026-12-26",
    });
    expect(healthScorePeriod(game, "custom", "2027-01-02", "2026-12-30").previous).toEqual({
      start: "2026-12-26",
      end: "2026-12-29",
    });
  });

  it("computes the synthetic demo week from its records rather than a fixed 82", () => {
    const game = createDemoGame(date, new Date(date + "T12:00:00").getTime());
    const result = healthScorePeriod(game, "week", date);
    expect(result.recordedDays).toBe(7);
    expect(result.metrics.every((metric) => metric.days === 7)).toBe(true);
    expect(result.score).toBe(79);
    expect(result.delta).toBeNull();
    expect(result.points).toHaveLength(7);
    expect(new Set(result.points.map((point) => point.score)).size).toBeGreaterThan(1);
  });
});
