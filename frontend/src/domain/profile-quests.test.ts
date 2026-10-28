import { describe, expect, it } from "vitest";
import { initialGame, restoreGame, rollDay, mainQuestCount } from "./game";
import {
  completeProfileQuest,
  startProfileQuests,
  profileQuestWindow,
  profileQuestStatus,
} from "./profile-quests";
const first = Date.parse("2026-10-28T10:00:00Z");
describe("first-week profile quests", () => {
  it("keeps the initial login time when initialized or restored again", () => {
    const game = startProfileQuests(initialGame("2026-10-28"), first);
    expect(startProfileQuests(game, first + profileQuestWindow)).toBe(game);
    expect(restoreGame(JSON.parse(JSON.stringify(game))).profileQuests.startedAt).toBe(first);
    expect(profileQuestStatus(game.profileQuests, "conditions", first - 1)).toBe("not-started");
  });
  it("awards each completed section once and preserves receipts across days and reloads", () => {
    const game = startProfileQuests(initialGame("2026-10-28"), first);
    const conditions = completeProfileQuest(game, "conditions", first + 1);
    expect(conditions.experience - game.experience).toBe(200);
    expect(conditions.gold).toBeGreaterThan(game.gold);
    expect(completeProfileQuest(conditions, "conditions", first + 2)).toBe(conditions);
    const restored = rollDay(restoreGame(JSON.parse(JSON.stringify(conditions))), "2026-10-29");
    expect(completeProfileQuest(restored, "conditions", first + 86400000)).toBe(restored);
    const lifestyle = completeProfileQuest(restored, "lifestyle", first + 86400000);
    expect(lifestyle.experience).toBe(400);
    expect(lifestyle.profileQuests.completed.conditions?.experience).toBe(200);
    expect(lifestyle.completed).toEqual([]);
    expect(mainQuestCount(lifestyle.completed)).toBe(0);
    expect(lifestyle.firstQuestExp).toEqual({});
  });
  it("accepts the last millisecond within 7 days and saves late completion without EXP", () => {
    const game = startProfileQuests(initialGame(), first);
    expect(
      completeProfileQuest(game, "conditions", first + profileQuestWindow - 1).experience,
    ).toBe(200);
    const late = completeProfileQuest(game, "conditions", first + profileQuestWindow);
    expect(late.experience).toBe(0);
    expect(late.gold).toBe(game.gold);
    expect(late.profileQuests.completed.conditions).toEqual({
      completedAt: first + profileQuestWindow,
      experience: 0,
    });
    expect(completeProfileQuest(late, "conditions", first + profileQuestWindow + 1)).toBe(late);
  });
  it("preserves existing users' full profiles without inventing retroactive rewards", () => {
    const snapshot = JSON.parse(JSON.stringify(initialGame()));
    delete snapshot.profileQuests;
    snapshot.experience = 1234;
    const restored = restoreGame(snapshot);
    expect(restored.experience).toBe(1234);
    const migrated = startProfileQuests(restored, first, true);
    expect(migrated.experience).toBe(1234);
    expect(migrated.profileQuests.completed.conditions?.experience).toBe(0);
    expect(migrated.profileQuests.completed.lifestyle?.experience).toBe(0);
    expect(completeProfileQuest(migrated, "conditions", first + 1)).toBe(migrated);
  });
  it("does not grant rewards before a recorded login or for invalid clocks", () => {
    const empty = initialGame();
    expect(completeProfileQuest(empty, "conditions", first)).toBe(empty);
    expect(startProfileQuests(empty, NaN)).toBe(empty);
    const game = startProfileQuests(empty, first);
    expect(completeProfileQuest(game, "conditions", first - 1)).toBe(game);
    expect(completeProfileQuest(game, "lifestyle", Infinity)).toBe(game);
  });
});
