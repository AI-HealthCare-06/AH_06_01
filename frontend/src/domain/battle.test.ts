import { describe, expect, it } from "vitest";
import { advanceCombat, battleBuffStats, initialCombat, migrateCombat, waveTarget } from "./battle";
import {
  characterStats,
  hydrationPenalty,
  incomingDamage,
  monsterGold,
  monsterStats,
  sleepGoldMultiplier,
  wavePolicies,
} from "./game-policy";
import { initialGame, rollDay, tickBattle } from "./game";

describe("document combat rules", () => {
  it("simulates a full 24 hours without reward attenuation and expires buffs at midnight", () => {
    const now = new Date(2026, 8, 29, 0).getTime();
    const game = { ...initialGame("2026-09-29"), battleUpdatedAt: now };
    const offline = tickBattle(game, now + 86_400_000);
    const direct = advanceCombat(game.combat, battleBuffStats(game), 1, 86_400_000);
    expect(offline.gold).toBe(direct.gold);
    expect(offline.battleDefeats).toBe(direct.defeats);
    expect(offline.gold).toBeGreaterThan(0);
    expect(tickBattle(offline, now + 86_400_000)).toBe(offline);
    const night = {
      ...game,
      activity: { water: 2 },
      sleepHours: 8,
      battleUpdatedAt: now + 23 * 3_600_000,
    };
    const before = advanceCombat(night.combat, battleBuffStats(night), 1, 3_600_000);
    const after = advanceCombat(
      before.combat,
      battleBuffStats(rollDay(night, "2026-09-30")),
      1,
      3_600_000,
    );
    const across = tickBattle(night, now + 25 * 3_600_000);
    expect(across.gold).toBe(before.gold + after.gold);
    expect(across.activity).toEqual({});
  });
  it("matches the level milestones, damage floor and monster tables", () => {
    expect([1, 5, 10, 15, 20].map(characterStats)).toEqual([
      { hp: 50, ad: 20, def: 10 },
      { hp: 80, ad: 31, def: 16 },
      { hp: 115, ad: 44, def: 23 },
      { hp: 150, ad: 57, def: 30 },
      { hp: 185, ad: 70, def: 37 },
    ]);
    expect(monsterStats(1, 10)).toEqual({ hp: 105, ad: 25, knockback: 0.2 });
    expect(monsterStats(3, 5, "elite")).toEqual({ hp: 540, ad: 60.06, knockback: 0.1 });
    expect(monsterStats(5, 10, "boss").knockback).toBe(0.05);
    expect(incomingDamage(20, 100, 0.6)).toBeCloseTo(0.8);
    expect(monsterGold(1, 10, "boss")).toBe(495);
    expect(monsterGold(2, 1, "normal", 1.2)).toBe(40);
  });
  it("spawns at distance 7 every 5 seconds, requires four hits and never attacks outside range", () => {
    const buffs = battleBuffStats(initialGame());
    const first = advanceCombat(initialCombat(), buffs, 1, 50);
    expect(first.combat.enemies[0].hp).toBe(70);
    expect(first.combat.enemies[0].distance).toBeCloseTo(6.94);
    const beforeRange = advanceCombat(initialCombat(), buffs, 1, 3300);
    expect(beforeRange.combat.lastAttack).toBeNull();
    const attack = advanceCombat(beforeRange.combat, buffs, 1, 50);
    expect(attack.combat.enemies[0].hp).toBe(50);
    expect(attack.combat.enemies[0].distance).toBeGreaterThan(3);
    expect(advanceCombat(attack.combat, buffs, 1, 50).combat.enemies[0].hp).toBe(50);
    const cleared = advanceCombat(initialCombat(), buffs, 1, 5100);
    expect(cleared.defeats).toBe(1);
    expect(cleared.gold).toBe(30);
    expect(cleared.combat.serial).toBe(2);
    expect(cleared.combat.enemies[0].hp).toBe(70);
  });
  it("uses 690 ordinary mobs plus Elite/Boss and preserves locked final-wave farming", () => {
    expect(wavePolicies.reduce((sum, wave) => sum + wave.count, 0)).toBe(690);
    expect(Array.from({ length: 10 }, (_, i) => waveTarget(i + 1))).toEqual([
      30, 40, 50, 60, 71, 70, 80, 90, 100, 101,
    ]);
    expect(migrateCombat(692, 5)).toMatchObject({ stage: 2, wave: 1, killed: 0 });
    expect(migrateCombat(692, 1)).toMatchObject({ stage: 1, wave: 10, killed: 0 });
    const end = { ...initialCombat(), wave: 10, killed: 100, spawned: 100 };
    const high = { ...battleBuffStats(initialGame()), attack: 10000 };
    const next = advanceCombat(end, high, 5, 5000);
    expect(next.combat).toMatchObject({ stage: 2, wave: 1 });
    expect(next.gold).toBe(495);
    expect(advanceCombat(end, high, 1, 5000).combat).toMatchObject({
      stage: 1,
      wave: 10,
      killed: 0,
    });
    const elite = advanceCombat(
      { ...initialCombat(), wave: 5, killed: 70, spawned: 70 },
      high,
      1,
      50,
    );
    expect(elite.combat.enemies[0].rank).toBe("elite");
  });
  it("applies stacks/caps, data-driven CRT, sleep and hydration without guessing absent data", () => {
    const game = {
      ...initialGame(),
      activity: { medicine: 9, meal: 9, water: 9 },
      sleepHours: 8,
      steps: { date: "2026-09-29", count: 16000, source: "healthkit" as const, syncedAt: 1 },
    };
    expect(battleBuffStats(game)).toMatchObject({
      attack: 26,
      adBonus: 0.3,
      defBonus: 0.6,
      asBonus: 0.8,
      crt: 1,
      gold: 1.2,
    });
    expect(battleBuffStats({ ...game, steps: { ...game.steps, count: 6000 } }).crt).toBe(0);
    expect(battleBuffStats({ ...game, steps: { ...game.steps, count: 8000 } }).crt).toBe(0.2);
    expect([null, 3, 4, 5, 7, 8].map(sleepGoldMultiplier)).toEqual([1, 0.8, 0.9, 1, 1.1, 1.2]);
    expect([null, 0.1, 0.25, 0.5, 0.75].map(hydrationPenalty)).toEqual([0, 0.3, 0.2, 0.1, 0]);
    expect(battleBuffStats(rollDay(game, "2099-01-01")).adBonus).toBe(0);
  });
  it("persists full-rate offline combat, credits once, and recovers from defeat", () => {
    const now = new Date(2026, 8, 29, 12).getTime();
    const game = { ...initialGame("2026-09-29"), battleUpdatedAt: now };
    const result = tickBattle(game, now + 60_000);
    expect(result.gold).toBeGreaterThan(0);
    expect(result.coins).toBe(game.coins);
    expect(tickBattle(result, now + 60_000)).toBe(result);
    const direct = advanceCombat(game.combat, battleBuffStats(game), 1, 60_000);
    expect(result.gold).toBe(direct.gold);
    expect(result.combat).toEqual(direct.combat);
    const dead = {
      ...initialCombat(),
      hp: 1,
      spawned: 1,
      spawnIn: 5000,
      attackIn: 500,
      enemies: [
        {
          id: 0,
          art: 0,
          rank: "normal" as const,
          hp: 70,
          maxHp: 70,
          ad: 20,
          distance: 2,
          attackIn: 0,
          ranged: true,
          hitAt: -1000,
        },
      ],
    };
    const recovery = advanceCombat(dead, battleBuffStats(game), 1, 50).combat;
    expect(recovery.recovery).toBe(10000);
    expect(advanceCombat(recovery, battleBuffStats(game), 1, 10000).combat.hp).toBe(50);
  });
});
