import { describe, expect, it } from "vitest";
import {
  advanceCombat,
  battleBuffStats,
  clearDuration,
  combatSchema,
  initialCombat,
  spawnBatchLimit,
  projectileSpeed,
  travelDuration,
  startDuration,
  waveTarget,
} from "./battle";
import { initialGame, purchaseAccessory, equipAccessory, restoreGame } from "./game";
import { enemyAttackRange } from "./battle-range";
import { experienceForLevel, experienceProgress } from "./experience";

const buffs = battleBuffStats(initialGame());
describe("mixed waves and travel", () => {
  it("randomizes group sizes and melee/ranged members, expands only above 50, and caps the quota", () => {
    const harmless = { ...buffs, maxHp: 100000, attack: 0, defBonus: 1 };
    for (const wave of [1, 3, 4, 5, 10]) {
      const cap = waveTarget(wave) > 50 ? 5 : 3;
      expect(spawnBatchLimit(wave)).toBe(cap);
      const sizes = new Set<number>();
      let mixed = false;
      for (let sample = 0; sample < 50; sample++) {
        const state = advanceCombat(
          { ...initialCombat(100000), wave, seed: 999 + sample * 100003, attackIn: 100000 },
          harmless,
          1,
          50,
        ).combat;
        expect(state.spawned).toBeGreaterThanOrEqual(1);
        expect(state.spawned).toBeLessThanOrEqual(cap);
        sizes.add(state.spawned);
        mixed ||= state.enemies.some((e) => e.ranged) && state.enemies.some((e) => !e.ranged);
        const baseHp = { 1: 70, 3: 77, 4: 81, 5: 84, 10: 105 }[wave]!;
        for (const enemy of state.enemies) {
          expect(enemy.hp).toBe(enemy.maxHp);
          expect(enemy.hp).toBe(Math.round(baseHp * (enemy.ranged ? 1 : 1.375)));
        }
      }
      expect([...sizes].sort()).toEqual(Array.from({ length: cap }, (_, i) => i + 1));
      expect(mixed).toBe(true);
      let state = { ...initialCombat(100000), wave, attackIn: 100000 };
      while (state.spawned < waveTarget(wave)) {
        const remaining = waveTarget(wave) - state.spawned;
        const before = state.spawned;
        state = advanceCombat({ ...state, spawnIn: 0 }, harmless, 1, 50).combat;
        expect(state.spawned - before).toBeGreaterThanOrEqual(1);
        expect(state.spawned - before).toBeLessThanOrEqual(Math.min(remaining, cap));
      }
      expect(state.spawned).toBe(waveTarget(wave));
      const final = advanceCombat({ ...state, spawnIn: 0 }, harmless, 1, 50).combat;
      expect(final.spawned).toBe(waveTarget(wave));
      expect(final.enemies.filter((e) => e.rank !== "normal").map((e) => e.rank)).toEqual(
        wave === 5 ? ["elite"] : wave === 10 ? ["boss"] : [],
      );
    }
  });
  it("preserves random spawn sequences across saved/offline simulation chunks", () => {
    const input = { ...initialCombat(100000), wave: 4 };
    const harmless = { ...buffs, maxHp: 100000, attack: 0, defBonus: 1 };
    const direct = advanceCombat(input, harmless, 1, 18000).combat;
    let chunked = input;
    for (let i = 0; i < 3; i++)
      chunked = advanceCombat(
        combatSchema.parse(JSON.parse(JSON.stringify(chunked))),
        harmless,
        1,
        6000,
      ).combat;
    expect(chunked).toEqual(direct);
  });
  it("launches at 7u, uses a 1000ms ranged cooldown, and applies damage only at impact", () => {
    const enemy = {
      id: 1,
      art: 0,
      rank: "normal" as const,
      hp: 70,
      maxHp: 70,
      ad: 20,
      distance: 7,
      attackIn: 0,
      ranged: true,
      hitAt: -1000,
    };
    expect(enemyAttackRange(enemy, 0)).toBe(7);
    const input = {
      ...initialCombat(),
      spawned: 1,
      spawnIn: 3000,
      attackIn: 5000,
      enemies: [enemy],
    };
    const fired = advanceCombat(input, buffs, 1, 50).combat;
    expect(fired.hp).toBe(50);
    expect(fired.enemies[0].attackIn).toBe(1000);
    expect(fired.projectiles).toHaveLength(1);
    const flying = advanceCombat(fired, buffs, 1, 700).combat;
    expect(flying.hp).toBe(50);
    expect(flying.projectiles[0].distance).toBeCloseTo(7 - projectileSpeed * 0.7);
    const hit = advanceCombat(flying, buffs, 1, 50).combat;
    expect(hit.hp).toBe(40);
    expect(hit.projectiles.some((shot) => shot.id === fired.projectiles[0].id)).toBe(false);
    expect(advanceCombat(hit, buffs, 1, 100).combat.hp).toBe(40);
    expect(input.enemies[0].attackIn).toBe(0);
  });
  it("persists clear/travel, prevents spawning during the effect, and unlocks the next stage after travel", () => {
    for (const [wave, kind] of [
      [1, "wave"],
      [10, "stage"],
    ] as const) {
      const input = {
        ...initialCombat(),
        wave,
        spawned: waveTarget(wave),
        killed: waveTarget(wave),
      };
      const clear = advanceCombat(input, buffs, 5, 50).combat;
      expect(clear.transition).toMatchObject({ kind, elapsed: 0, arrived: false });
      const travel = advanceCombat(clear, buffs, 5, clearDuration(kind)).combat;
      expect(travel.enemies).toHaveLength(0);
      expect(travel.wave).toBe(wave);
      const saved = combatSchema.parse(JSON.parse(JSON.stringify(travel)));
      const next = advanceCombat(saved, buffs, 5, travelDuration).combat;
      expect(next.transition?.arrived).toBe(true);
      expect(next).toMatchObject({
        stage: wave === 10 ? 2 : 1,
        wave: wave === 10 ? 1 : 2,
        spawned: 0,
      });
      const ready = advanceCombat(next, buffs, 5, startDuration).combat;
      expect(ready.transition).toBeNull();
      expect(ready.spawned).toBe(0);
      expect(advanceCombat(ready, buffs, 5, 50).combat.spawned).toBe(1);
    }
  });
  it("restores old saved combat without losing progress", () => {
    const old = {
      ...initialCombat(),
      wave: 2,
      killed: 4,
      spawned: 4,
      projectiles: undefined,
      playerProjectiles: undefined,
      lastHit: undefined,
      transition: undefined,
    };
    expect(combatSchema.parse(old)).toMatchObject({
      wave: 2,
      killed: 4,
      projectiles: [],
      playerProjectiles: [],
      lastHit: null,
      transition: null,
    });
  });
  it("uses exact experience thresholds for level debugging", () => {
    for (let level = 1; level <= 100; level++)
      expect(experienceProgress(experienceForLevel(level)).level).toBe(level);
    expect(experienceForLevel(3)).toBe(222);
  });
});

describe("local accessory purchases", () => {
  it("charges once, rejects unowned equipment and insufficient gold, persists selection", () => {
    const game = initialGame();
    expect(equipAccessory(game, "AviatorCap")).toBe(game);
    const bought = purchaseAccessory(game, "AviatorCap");
    expect(bought.gold).toBe(game.gold - 520);
    expect(purchaseAccessory(bought, "AviatorCap")).toBe(bought);
    expect(purchaseAccessory(bought, "JewelCrown")).toBe(bought);
    const equipped = equipAccessory(bought, "AviatorCap");
    expect(equipped.equippedAccessories.head).toBe("AviatorCap");
    expect(restoreGame(JSON.parse(JSON.stringify(equipped))).equippedAccessories.head).toBe(
      "AviatorCap",
    );
    expect(equipAccessory(equipped, "AviatorCap").equippedAccessories.head).toBeNull();
  });
});
