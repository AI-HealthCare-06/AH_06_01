import { describe, expect, it } from "vitest";
import { directRewardGold, rpAllowance } from "./economy";
import { convertDemoRp, initialGame, purchaseEffect, restoreGame } from "./game";

describe("Gold currency and reward limits", () => {
  it("merges legacy Coin and Gold once, including rewards, without refunding later spending", () => {
    const legacy = {
      ...initialGame(),
      version: 1,
      coins: 6610,
      gold: 10848,
      lastReward: { questId: "meal", coins: 1000, experience: 30 },
    };
    const migrated = restoreGame(legacy);
    expect(migrated).toMatchObject({ version: 2, gold: 17458, lastReward: { gold: 1000 } });
    expect(migrated).not.toHaveProperty("coins");
    expect(migrated.lastReward).not.toHaveProperty("coins");
    const spent = purchaseEffect(convertDemoRp(migrated, 100), "emerald");
    expect(spent.gold).toBe(6458);
    expect(restoreGame(JSON.parse(JSON.stringify(spent)))).toEqual(spent);
    expect(restoreGame({ ...spent, coins: 6610 }).gold).toBe(6458);
    expect(restoreGame({ ...legacy, gold: undefined }).gold).toBe(6610);
  });
  it("atomically exchanges Gold at 100:1, caps by all periods, and persists the ledger", () => {
    const date = "2026-09-29";
    const game = { ...initialGame(date), gold: 100000 };
    expect(convertDemoRp(game, 151, date)).toBe(game);
    const changed = convertDemoRp(game, 150, date);
    expect(changed).toMatchObject({ gold: 85000, rp: 150, experience: 0 });
    expect(convertDemoRp(changed, 1, date)).toBe(changed);
    expect(restoreGame(JSON.parse(JSON.stringify(changed))).rpLedger).toEqual([
      { date, amount: 150 },
    ]);
    const ledger = [
      { date: "2026-09-27", amount: 950 },
      { date: "2026-09-01", amount: 3040 },
    ];
    expect(rpAllowance(ledger, date)).toEqual({
      daily: 150,
      weekly: 50,
      monthly: 10,
      available: 10,
    });
    expect(rpAllowance(ledger, "2026-10-01")).toEqual({
      daily: 150,
      weekly: 50,
      monthly: 4000,
      available: 50,
    });
    for (const invalid of [-1, NaN, Infinity, 1.5])
      expect(convertDemoRp(game, invalid, date)).toBe(game);
  });
  it("checks receipt replay, registered medicine schedules, daily caps and cross-midnight water cooldown", () => {
    const medicine = { id: "m1", kind: "medicine" as const, date: "2026-09-29", at: 100 };
    expect(directRewardGold(medicine, [])).toBe(0);
    const scheduled = { ...medicine, scheduleId: "morning" };
    expect(directRewardGold(scheduled, [])).toBe(500);
    expect(directRewardGold(scheduled, [scheduled])).toBe(0);
    expect(directRewardGold({ ...scheduled, id: "m2" }, [scheduled])).toBe(0);
    const water = { id: "w1", kind: "water" as const, date: "2026-09-29", at: 100 };
    expect(
      directRewardGold({ ...water, id: "w2", date: "2026-09-30", at: 7_200_099 }, [water]),
    ).toBe(0);
    expect(directRewardGold({ ...water, id: "w2", at: 7_200_100 }, [water])).toBe(300);
    const accepted = Array.from({ length: 4 }, (_, i) => ({
      ...water,
      id: `w${i}`,
      at: i * 7_200_000,
    }));
    expect(directRewardGold({ ...water, id: "w5", at: 5 * 7_200_000 }, accepted)).toBe(0);
  });
  it("charges an appearance once without increasing combat stats or spending RP", () => {
    const game = { ...initialGame(), gold: 1100 };
    const purchased = purchaseEffect(game, "emerald");
    expect(purchased).toMatchObject({
      gold: 100,
      rp: 0,
      battleEffect: "emerald",
    });
    expect(purchaseEffect(purchased, "emerald").gold).toBe(100);
    expect(purchaseEffect(purchased, "violet")).toBe(purchased);
    expect(purchased.combat).toEqual(game.combat);
  });
});
