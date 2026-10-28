import { describe, it, expect } from "vitest";
import { rankSubQuests, type QuestAnalysis } from "./quest-analysis";
const analysis = {
  m1: {
    stage_top: null,
    stage_probs: null,
    risk_level: null,
    reason_codes: [],
    data_quality: "not_applicable",
    model_version: "pinned-test",
    feature_version: "1.2.0",
  },
  m1_bridge: { step: "htn", source: "medication-contract" },
  m2: {
    module: "M2",
    contract_version: "0.2.0",
    data_quality: "ok",
    states: { NOCTURNAL_SCREEN: { status: "positive", missing_required: [], notes: [] } },
  },
  previous_day: {
    date: "2026-10-21",
    completed_quests: ["meal", "water"],
    steps: 4700,
    sleep_hours: 5.6,
  },
  source: "synthetic-demo",
  as_of: "2026-10-22",
} as QuestAnalysis;
describe("transparent Sub Quest priorities", () => {
  it("uses missed schedules, known sleep and known steps, without suggesting extra medication", () => {
    const ranked = rankSubQuests(analysis, true);
    expect(ranked.map((q) => q.quest)).toEqual(["medicine", "survey", "walk"]);
    expect(ranked[1].reason).toContain("건강 서베이");
    expect(ranked.some((q) => q.quest === "sleep")).toBe(false);
    expect(ranked[1].modelCodes).toEqual(["NOCTURNAL_SCREEN"]);
    expect(rankSubQuests(analysis, false).some((q) => q.quest === "medicine")).toBe(false);
  });
  it("does not invent yesterday's failures from missing records or rejected input", () => {
    expect(
      rankSubQuests(
        {
          ...analysis,
          previous_day: {
            ...analysis.previous_day,
            completed_quests: null,
            steps: null,
            sleep_hours: null,
          },
        },
        true,
      ),
    ).toEqual([]);
    expect(
      rankSubQuests({ ...analysis, m2: { ...analysis.m2, data_quality: "invalid" } }, true),
    ).toEqual([]);
  });
});
