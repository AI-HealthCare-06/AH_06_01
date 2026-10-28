import type { GameState } from "../domain/game";
let account: string | null = null;
export function setDailySurveyAccount(userId: string | null) {
  account = userId;
}
const key = (id: string) => "rexrun-daily-survey-game-v1:" + id;
export function cacheDailySurveyGame(game: GameState) {
  if (!account || !Object.keys(game.dailySurveys).length) return null;
  try {
    localStorage.setItem(
      key(account),
      JSON.stringify(game, (k, v) => (k === "debugBuffs" ? undefined : v)),
    );
    return true;
  } catch {
    return false;
  }
}
export function readDailySurveyGame(userId: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key(userId)) ?? "null");
  } catch {
    return null;
  }
}

export function clearDailySurveyGame() {
  if (!account) return;
  try {
    localStorage.removeItem(key(account));
  } catch {
    /* Optional device storage. */
  }
}
