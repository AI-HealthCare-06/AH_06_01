import { describe, expect, it } from "vitest";
import { calendarWeek, localDate } from "./calendar";
import {
  completeQuest,
  initialGame,
  questProgress,
  quests,
  rollDay,
  syncDeviceSteps,
  weeklyCompletedDays,
} from "./game";

describe("device dates and quest progression", () => {
  it("starts Sunday across month and year boundaries", () => {
    expect(calendarWeek("2027-01-01").map((d) => d.date)).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(calendarWeek("2026-09-27")[0].label).toBe("일");
    expect(localDate(new Date(2026, 8, 29, 23))).toBe("2026-09-29");
  });
  it("requires measured steps and automatically completes at 6000 only once", () => {
    const day = "2026-09-29";
    const game = initialGame(day);
    expect(completeQuest(game, "walk", day)).toBe(game);
    const snapshot = { date: day, count: 3000, syncedAt: 100, source: "healthkit" };
    const half = syncDeviceSteps(game, snapshot, day);
    expect(questProgress(half, quests[2])).toBe(0.5);
    const done = syncDeviceSteps(half, { ...snapshot, count: 6000, syncedAt: 200 }, day);
    expect(done.completed).toEqual(["walk"]);
    expect(done.gold).toBe(1280);
    expect(syncDeviceSteps(done, { ...snapshot, count: 6800, syncedAt: 300 }, day).gold).toBe(1280);
    expect(syncDeviceSteps(done, snapshot, day)).toBe(done);
    expect(syncDeviceSteps(done, { ...snapshot, date: "2026-09-28" }, day)).toBe(done);
    expect(syncDeviceSteps(done, { ...snapshot, count: -1 }, day)).toBe(done);
    expect(rollDay(done, "2026-09-30").steps).toBeNull();
  });
  it("records one qualifying day for all quests, preserves history, resets only the weekly count", () => {
    let game = initialGame("2026-09-27");
    for (const day of ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]) {
      game = syncDeviceSteps(
        game,
        { date: day, count: 6500, syncedAt: 100, source: "health-connect" },
        day,
      );
      expect(weeklyCompletedDays(game)).toBe(game.completedDates.length);
      for (const q of quests)
        game = completeQuest(game, q.id, day, new Date(`${day}T12:00:00`).getTime());
      game = completeQuest(game, "sleep", day);
    }
    expect(weeklyCompletedDays(game)).toBe(5);
    expect(game.completedDates).toHaveLength(5);
    const nextWeek = rollDay(game, "2026-10-04");
    expect(weeklyCompletedDays(nextWeek)).toBe(0);
    expect(nextWeek.completedDates).toHaveLength(5);
  });
});
