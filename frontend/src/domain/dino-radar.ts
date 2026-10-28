import { mainQuestCount, type GameState } from "./game";
export const radarAxes = ["복용", "식사", "수면", "서베이", "걸음", "퀘스트"] as const;
export function radarRecord(game: GameState, date: string): (number | null)[] {
  const ids = date === game.date ? game.completed : game.questHistoryDetails[date];
  const row = game.healthHistory[date];
  const sleep = date === game.date ? game.sleepHours : row?.sleepHours;
  const steps = date === game.date ? game.steps?.count : row?.steps;
  const ratio = (value: number | null | undefined, goal: number) =>
    value === null || value === undefined ? null : Math.min(100, Math.round((value / goal) * 100));
  return [
    ids ? (ids.includes("medicine") ? 100 : 0) : null,
    ids ? (ids.includes("meal") ? 100 : 0) : null,
    ratio(sleep, 7),
    game.dailySurveys[date] ? 100 : ids ? 0 : null,
    ratio(steps, 6000),
    ids ? mainQuestCount(ids) * 25 : null,
  ];
}
export function radarData(game: GameState) {
  const first =
    [
      ...new Set([
        ...Object.keys(game.healthHistory),
        ...Object.keys(game.questHistoryDetails),
        ...Object.keys(game.dailySurveys),
      ]),
    ]
      .filter((day) => day <= game.date)
      .sort()[0] ?? game.date;
  const elapsed =
    Math.round(
      (new Date(game.date + "T12:00:00").getTime() - new Date(first + "T12:00:00").getTime()) /
        86_400_000,
    ) + 1;
  return {
    axes: radarAxes,
    first,
    elapsed,
    dayOne: radarRecord(game, first),
    today: radarRecord(game, game.date),
  };
}
