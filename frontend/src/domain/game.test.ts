import { surveyFixture } from "./daily-survey.test-fixture";
import { recordDailySurvey, mainQuests } from "./game";
import { describe, expect, it } from "vitest";
import {
  claimDailyBonus,
  applyDinosaurStyle,
  selectDinosaur,
  completeQuest,
  initialGame,
  restoreGame,
  rollDay,
  seoulDate,
  stageProgress,
  syncDeviceSteps,
} from "./game";
describe("demo reward rules", () => {
  it("awards a quest once, including retries", () => {
    const initial = initialGame();
    const first = syncDeviceSteps(initial, {
      date: initial.date,
      count: 6000,
      source: "healthkit",
      syncedAt: 100,
    });
    expect(first.gold).toBe(2580);
    expect(first.completed).toContain("walk");
    expect(completeQuest(first, "walk")).toBe(first);
  });
  it("awards the attained level's Gold exactly once across all quests", () => {
    let game = initialGame();
    game = syncDeviceSteps(game, {
      date: game.date,
      count: 6000,
      source: "healthkit",
      syncedAt: 100,
    });
    game = recordDailySurvey(game, surveyFixture(game.date), game.date);
    for (const q of mainQuests) game = completeQuest(game, q.id);
    expect(game.gold).toBe(6780);
    expect(game.lastReward?.experience).toBe(120);
    expect(game.allDoneBonusClaimed).toBe(true);
    expect(completeQuest(game, "sleep").gold).toBe(6780);
    expect(stageProgress(game)).toBe(10);
  });
  it("daily coin is idempotent and available again next Seoul day", () => {
    const game = claimDailyBonus(initialGame("2026-09-28"), "2026-09-28");
    expect(game.gold).toBe(1290);
    expect(claimDailyBonus(game, "2026-09-28")).toBe(game);
    const next = claimDailyBonus(game, "2026-09-29");
    expect(next.gold).toBe(1300);
    expect(next.completed).toEqual([]);
  });
  it("resets daily flags while preserving currency and dinosaur", () => {
    const initial = {
      ...initialGame("2026-09-27"),
      dinosaur: 4,
      gold: 1500,
      bonusClaimed: true,
      allDoneBonusClaimed: true,
    };
    const next = rollDay(initial, "2026-09-28");
    expect(next).toMatchObject({
      date: "2026-09-28",
      gold: 1500,
      dinosaur: 4,
      completed: [],
      bonusClaimed: false,
      allDoneBonusClaimed: false,
      lastReward: null,
    });
    expect(stageProgress(next)).toBe(0);
  });
  it("uses the Seoul midnight boundary", () => {
    expect(seoulDate(new Date("2026-09-27T14:59:59Z"))).toBe("2026-09-27");
    expect(seoulDate(new Date("2026-09-27T15:00:00Z"))).toBe("2026-09-28");
  });
  it("recovers invalid storage and removes repeated quest ids", () => {
    expect(restoreGame({ gold: -100 })).toMatchObject({
      gold: 1280,
      experience: 0,
      completed: [],
    });
    const data = { ...initialGame(), completed: ["walk", "walk"] };
    expect(restoreGame(data).completed).toEqual(["walk"]);
  });
  it("restores older saves without losing currency, quests or selected character", () => {
    const legacy: Record<string, unknown> = { ...initialGame(), gold: 1700, dinosaur: 3 };
    delete legacy.dinosaurStyles;
    delete legacy.showBattleDamage;
    delete legacy.showMonsterHealth;
    const restored = restoreGame(legacy);
    expect(restored).toMatchObject({
      gold: 1700,
      dinosaur: 3,
      completed: [],
      showBattleDamage: true,
      showMonsterHealth: true,
    });
    expect(restored.dinosaurStyles).toEqual(Array(6).fill("original"));
    expect(restoreGame({ ...legacy, dinosaurStyles: ["bad-skin"] })).toEqual(restored);
  });
  it("keeps each character's style across switching, reload and day rollover without spending Gold", () => {
    const initial = initialGame();
    const first = applyDinosaurStyle(initial, 3, "ocean");
    const second = applyDinosaurStyle(first, 1, "gold");
    const restored = restoreGame(JSON.parse(JSON.stringify(second)));
    expect(restored.dinosaur).toBe(1);
    expect(restored.dinosaurStyles[3]).toBe("ocean");
    expect(restored.dinosaurStyles[1]).toBe("gold");
    expect(restored.gold).toBe(initial.gold);
    expect(restored.completed).toEqual(initial.completed);
    const next = rollDay(restored, "2099-01-01");
    expect(next.dinosaurStyles).toEqual(restored.dinosaurStyles);
    expect(next.dinosaur).toBe(1);
    expect(initial.dinosaurStyles).toEqual(Array(6).fill("original"));
  });
  it("ignores invalid character/style actions", () => {
    const initial = initialGame();
    expect(applyDinosaurStyle(initial, -1, "ocean")).toBe(initial);
    expect(applyDinosaurStyle(initial, 6, "ocean")).toBe(initial);
    expect(applyDinosaurStyle(initial, 1.5, "ocean")).toBe(initial);
    // Untrusted persisted/UI values must not overwrite a valid style.
    expect(applyDinosaurStyle(initial, 2, "unknown" as "ocean")).toBe(initial);
  });
  it("switching characters clears outgoing shots and pending attacks while preserving battle progress", () => {
    const initial = initialGame();
    const input = {
      ...initial,
      combat: {
        ...initial.combat,
        wave: 2,
        killed: 7,
        hp: 45,
        attackIn: 300,
        pendingGold: 210,
        playerProjectiles: [
          {
            id: "old",
            dinosaur: 0,
            x: 150,
            y: 200,
            vx: 240,
            vy: 0,
            age: 80,
            travelled: 20,
            damage: 20,
            critical: false,
          },
        ],
        projectiles: [{ id: "enemy", art: 0, origin: 7, distance: 4, damage: 5 }],
        lastAttack: {
          time: 0,
          mode: "ranged" as const,
          duration: 500,
          impactAt: 150,
          distance: 7,
          damage: 20,
          critical: false,
          resolved: false,
        },
      },
    };
    const selected = selectDinosaur(input, 4);
    expect(selected.dinosaur).toBe(4);
    expect(selected.combat).toEqual({ ...input.combat, playerProjectiles: [], lastAttack: null });
    expect(input.combat.playerProjectiles).toHaveLength(1);
    expect(selected.gold).toBe(input.gold);
    expect(selected.experience).toBe(input.experience);
    expect(selectDinosaur(input, 0)).toBe(input);
    expect(selectDinosaur(input, 6)).toBe(input);
    expect(applyDinosaurStyle(input, 0, "ocean").combat).toBe(input.combat);
    expect(applyDinosaurStyle(input, 4, "ocean").combat).toEqual(selected.combat);
    expect(restoreGame(JSON.parse(JSON.stringify(selected))).combat.playerProjectiles).toHaveLength(
      0,
    );
  });
});
