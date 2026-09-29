import { describe, expect, it } from "vitest";
import { battleBuffStats, battleStage } from "./battle";
import { collectBattleCoin, initialGame, questIds, rollDay } from "./game";

describe("worlds, substages and daily quest buffs", () => {
  it("finishes ten substages before changing world and raises every target", () => {
    expect(battleStage(9)).toEqual({ world: 1, substage: 1, target: 10, progress: 9 });
    expect(battleStage(10)).toEqual({ world: 1, substage: 2, target: 11, progress: 0 });
    expect(battleStage(126)).toEqual({ world: 1, substage: 10, target: 19, progress: 0 });
    expect(battleStage(144)).toEqual({ world: 1, substage: 10, target: 19, progress: 18 });
    expect(battleStage(145)).toEqual({ world: 2, substage: 1, target: 20, progress: 0 });
    expect(battleStage(390)).toEqual({ world: 3, substage: 1, target: 30, progress: 0 });
  });
  it("preserves all existing defeats even after the background library cycles", () => {
    let defeats = 0;
    for (let n = 0; n < 90; n++) {
      const stage = battleStage(defeats);
      expect(stage.target).toBe(10 + n);
      expect(stage.progress).toBe(0);
      expect(stage.world).toBe(Math.floor(n / 10) + 1);
      expect(battleStage(defeats + stage.target - 1).progress).toBe(stage.target - 1);
      defeats += stage.target;
    }
  });
  it("activates only completed quest buffs, resets daily and grants bonus coins once", () => {
    const base = initialGame("2026-09-29");
    const game = { ...base, completed: [...questIds] };
    expect(battleBuffStats(game.completed)).toEqual({
      maxHp: 380,
      attackSpeed: 1.15,
      moveSpeed: 1.2,
      coinReward: 12,
    });
    const won = collectBattleCoin(game, 0);
    expect(won.coins).toBe(game.coins + 12);
    expect(collectBattleCoin(won, 0)).toBe(won);
    expect(battleBuffStats(rollDay(game, "2026-09-30").completed)).toEqual(
      battleBuffStats(base.completed),
    );
  });
});
