import { afterEach, expect, it, vi } from "vitest";
import {
  cacheDailySurveyGame,
  readDailySurveyGame,
  setDailySurveyAccount,
} from "./daily-survey-cache";
import { initialGame } from "../domain/game";
import { surveyFixture } from "../domain/daily-survey.test-fixture";
afterEach(() => {
  setDailySurveyAccount(null);
  vi.unstubAllGlobals();
});
it("keeps unconsented daily records on this device and isolates account caches", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    setItem: (k: string, v: string) => data.set(k, v),
    getItem: (k: string) => data.get(k) ?? null,
  });
  const game = initialGame("2026-10-27");
  game.dailySurveys[game.date] = surveyFixture(game.date);
  setDailySurveyAccount("first");
  cacheDailySurveyGame(game);
  expect(readDailySurveyGame("first")).toEqual(game);
  setDailySurveyAccount(null);
  cacheDailySurveyGame({ ...game, gold: 0 });
  expect(readDailySurveyGame("first")).toEqual(game);
  setDailySurveyAccount("second");
  expect(readDailySurveyGame("second")).toBeNull();
  cacheDailySurveyGame({ ...game, gold: 300 });
  expect((readDailySurveyGame("first") as { gold: number }).gold).toBe(game.gold);
  expect((readDailySurveyGame("second") as { gold: number }).gold).toBe(300);
});
