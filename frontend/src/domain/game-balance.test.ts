/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { advanceCombat, battleBuffStats, initialCombat } from "./battle";
import { initialGame } from "./game";
import { experienceProgress } from "./experience";

function openingRun(dinosaur: number, seed: number) {
  let game = { ...initialGame("2026-10-21"), dinosaur };
  game.combat = { ...initialCombat(), seed };
  let firstClearSeconds: number | null = null;
  let failures = 0;
  for (let second = 1; second <= 300; second++) {
    const result = advanceCombat(
      game.combat,
      battleBuffStats(game),
      experienceProgress(game.experience).level,
      1000,
      game.experience,
    );
    if (result.combat.lastFailure?.time !== game.combat.lastFailure?.time) failures++;
    if (firstClearSeconds === null && result.combat.transition) firstClearSeconds = second;
    game = { ...game, combat: result.combat, experience: game.experience + result.defeats };
  }
  return {
    dinosaur,
    seed,
    firstClearSeconds,
    failures,
    kills: game.experience,
    wave: game.combat.wave,
    hp: game.combat.hp,
  };
}

describe("unbuffed opening combat", () => {
  it("compares the same six dinosaurs and saved RNG seeds over five minutes", () => {
    const results = Array.from({ length: 6 }, (_, dino) =>
      [42, 1234, 3000].map((seed) => openingRun(dino, seed)),
    ).flat();
    if (process.env.REXRUN_BALANCE_REPORT) {
      writeFileSync(
        resolve(
          "../.cache/model-integration",
          `game-balance-${process.env.REXRUN_BALANCE_REPORT}.json`,
        ),
        JSON.stringify({ seconds: 300, buffs: false, results }, null, 2),
      );
    }
    for (const result of results) {
      expect(result.firstClearSeconds, JSON.stringify(result)).not.toBeNull();
      expect(result.firstClearSeconds).toBeLessThan(120);
      expect(result.failures).toBeLessThanOrEqual(1);
      expect(result.kills).toBeGreaterThanOrEqual(80);
      expect(result.wave).toBeGreaterThanOrEqual(2);
    }
  }, 60000);

  it("updates saved enemies once without healing them or resetting wave progress", () => {
    const legacy = {
      ...initialCombat(),
      balanceRevision: 1,
      killed: 12,
      spawned: 13,
      enemies: [
        {
          id: 0,
          art: 1,
          rank: "normal" as const,
          ranged: true,
          hp: 35,
          maxHp: 70,
          ad: 20,
          distance: 7,
          attackIn: 500,
          hitAt: -1000,
        },
      ],
      projectiles: [{ id: "0-50", ownerId: 0, art: 1, distance: 6, origin: 7, damage: 10 }],
    };
    const buffs = battleBuffStats(initialGame());
    const result = advanceCombat(legacy, buffs, 1, 0).combat;
    expect(result).toMatchObject({ balanceRevision: 2, killed: 12, spawned: 13 });
    expect(result.enemies[0]).toMatchObject({ hp: 25, maxHp: 50, ad: 11 });
    expect(result.projectiles[0].damage).toBeCloseTo(1.1);
    expect(advanceCombat(result, buffs, 1, 0).combat).toEqual(result);
    expect(legacy.enemies[0].hp).toBe(35);
  });
});
