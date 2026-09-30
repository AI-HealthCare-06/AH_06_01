import { describe, expect, it } from "vitest";
import {
  advanceCombat,
  battleBuffStats,
  clearDuration,
  combatSchema,
  initialCombat,
  isRangedSpawn,
  projectileSpeed,
  travelDuration,
  waveTarget,
} from "./battle";
import { initialGame, purchaseAccessory, equipAccessory, restoreGame } from "./game";
import { enemyAttackRange } from "./battle-range";
import { experienceForLevel, experienceProgress } from "./experience";

const buffs = battleBuffStats(initialGame());
describe("mixed waves and travel", () => {
  it("spawns exactly 7 melee and 3 ranged per ten, independently of appearance", () => {
    expect(Array.from({ length: 30 }, (_, i) => isRangedSpawn(i)).filter(Boolean)).toHaveLength(9);
    const state = advanceCombat(
      initialCombat(100000),
      { ...buffs, maxHp: 100000, attack: 0, defBonus: 1 },
      1,
      87050,
    ).combat;
    expect(state.spawned).toBe(30);
    expect(state.enemies.filter((e) => e.ranged)).toHaveLength(9);
    expect(state.enemies.filter((e) => !e.ranged)).toHaveLength(21);
    expect(advanceCombat(initialCombat(), buffs, 1, 3000).combat.spawned).toBe(2);
  });
  it("launches at 3u, respects the old 500ms cooldown, and applies damage only at impact", () => {
    const enemy = {
      id: 1,
      art: 0,
      rank: "normal" as const,
      hp: 70,
      maxHp: 70,
      ad: 20,
      distance: 3,
      attackIn: 0,
      ranged: true,
      hitAt: -1000,
    };
    expect(enemyAttackRange(enemy, 0)).toBe(3);
    const input = {
      ...initialCombat(),
      spawned: 1,
      spawnIn: 3000,
      attackIn: 5000,
      enemies: [enemy],
    };
    const fired = advanceCombat(input, buffs, 1, 50).combat;
    expect(fired.hp).toBe(50);
    expect(fired.enemies[0].attackIn).toBe(500);
    expect(fired.projectiles).toHaveLength(1);
    const flying = advanceCombat(fired, buffs, 1, 450).combat;
    expect(flying.hp).toBe(50);
    expect(flying.projectiles[0].distance).toBeCloseTo(3 - projectileSpeed * 0.45);
    expect(advanceCombat(flying, buffs, 1, 50).combat.hp).toBe(40);
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
      expect(clear.transition).toEqual({ kind, elapsed: 0 });
      const travel = advanceCombat(clear, buffs, 5, clearDuration(kind)).combat;
      expect(travel.enemies).toHaveLength(0);
      expect(travel.wave).toBe(wave);
      const saved = combatSchema.parse(JSON.parse(JSON.stringify(travel)));
      const next = advanceCombat(saved, buffs, 5, travelDuration).combat;
      expect(next.transition).toBeNull();
      expect(next).toMatchObject({
        stage: wave === 10 ? 2 : 1,
        wave: wave === 10 ? 1 : 2,
        spawned: 0,
      });
      expect(advanceCombat(next, buffs, 5, 50).combat.spawned).toBe(1);
    }
  });
  it("restores old saved combat without losing progress", () => {
    const old = {
      ...initialCombat(),
      wave: 2,
      killed: 4,
      spawned: 4,
      projectiles: undefined,
      transition: undefined,
    };
    expect(combatSchema.parse(old)).toMatchObject({
      wave: 2,
      killed: 4,
      projectiles: [],
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
