import { describe, it, expect } from "vitest";
import {
  eligibleExercises,
  ruleCoachPlan,
  type CoachSurvey,
  type CoachContext,
} from "./exercise-coach";
import { initialGame, restoreGame } from "./game";
const survey: CoachSurvey = {
  motivation: "fun",
  context: "ott",
  minutes: 10,
  activity: "inactive",
  period: "evening",
  limits: [],
  clinicianCleared: true,
  alcoholDays: 3,
  binge: true,
  updatedAt: 1,
};
const context: CoachContext = {
  age: 34,
  hypertension: true,
  pressure: { systolic: 145, diastolic: 94 },
  pressureDate: "2026-11-03",
  pregnancy: false,
  recentCompleted: 0,
};
describe("personalized exercise constraints", () => {
  it("starts sedentary users at short, enjoyable activities", () => {
    const plan = ruleCoachPlan("2026-11-03", survey, context);
    expect(plan.items[0].id).toBe("ott-walk");
    expect(plan.source).toBe("rules");
    expect(plan.model).toBeNull();
    expect(plan.items.some((i) => i.id === "long-walk")).toBe(false);
  });
  it.each([
    { systolic: 180, diastolic: 90 },
    { systolic: 150, diastolic: 120 },
  ])("blocks exercise at very high readings %j", (pressure) =>
    expect(eligibleExercises(survey, { ...context, pressure }).items).toHaveLength(0),
  );
  it("does not equate missing BP with normal BP", () =>
    expect(
      eligibleExercises(survey, { ...context, pressure: null, pressureDate: null }).items.every(
        (i) => i.kind === "stretch",
      ),
    ).toBe(true));
  it("respects medical restrictions and reported body limitations", () => {
    expect(eligibleExercises({ ...survey, clinicianCleared: false }, context).items).toHaveLength(
      0,
    );
    expect(eligibleExercises({ ...survey, limits: ["doctor"] }, context).items).toHaveLength(0);
    expect(
      eligibleExercises({ ...survey, limits: ["shoulder", "knee", "back"] }, context).items.map(
        (i) => i.id,
      ),
    ).toEqual(["ankle-pump"]);
    expect(eligibleExercises(survey, { ...context, pregnancy: true }).items).toHaveLength(0);
  });
  it("restores old saves with empty coaching fields", () => {
    const game = initialGame();
    const legacy = { ...game, exerciseCoach: undefined };
    expect(restoreGame(legacy).exerciseCoach).toEqual({ survey: null, plan: null, completed: {} });
  });
});
