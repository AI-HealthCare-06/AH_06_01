import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestAnalysis } from "../domain/quest-analysis";
import { initialGame, type GameState } from "../domain/game";
import { initialProfile, type HealthProfile } from "../domain/profile";
import { createDemoGame } from "../domain/demo-persona";
import { quarterDemoPersona } from "../domain/demo-personas";

const state = vi.hoisted(() => ({
  analysis: undefined as QuestAnalysis | undefined,
  failed: false,
  hook: vi.fn(),
  game: undefined as GameState | undefined,
  profileState: undefined as
    | { profile: HealthProfile; hasProfileInput: boolean; hasBloodPressureInput: boolean }
    | undefined,
}));
vi.mock("../stores/game-store", () => ({
  useGameStore: (selector: (s: { game: GameState }) => unknown) => selector({ game: state.game! }),
}));
vi.mock("../stores/profile-store", () => ({ useProfileStore: () => state.profileState }));
vi.mock("../services/useQuestAnalysis", () => ({
  useQuestAnalysis: () => {
    state.hook();
    return { data: state.analysis, ready: true, isError: state.failed };
  },
}));
import { DashboardPredictionBrief } from "./DashboardPredictionBrief";

function render(props: Parameters<typeof DashboardPredictionBrief>[0] = {}) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(DashboardPredictionBrief, props)),
  );
}

describe("dashboard HTN screening summary", () => {
  beforeEach(() => {
    state.hook.mockClear();
    state.failed = false;
    state.analysis = undefined;
    state.game = initialGame("2026-11-02");
    state.profileState = {
      profile: initialProfile,
      hasProfileInput: false,
      hasBloodPressureInput: false,
    };
  });
  it("prioritizes a measurement recommendation over a normal stage and zero M2 findings", () => {
    state.analysis = {
      m1: {
        stage_probs: { normal: 0.6, elevated: 0.1, prehtn: 0.15, htn: 0.15 },
        stage_top: "normal",
        risk_level: "normal",
        reason_codes: [],
        data_quality: "ok",
        model_version: "M1-20261020_150607-nested__base-htn-screen-v1",
        feature_version: "1.2.0",
        htn_screening: {
          positive: true,
          probability: 0.15,
          threshold: 0.12143345115658617,
          policy_id: "htn-screen-v1",
        },
      },
      m1_bridge: { step: "normal", source: "M1-S" },
      m2: { module: "M2", contract_version: "test", data_quality: "ok", states: {} },
      previous_day: {
        date: "2026-11-01",
        completed_quests: null,
        steps: null,
        sleep_hours: null,
      },
      source: "synthetic-demo",
      as_of: "2026-11-02",
    };
    const html = render();
    expect(html).toContain("혈압 확인 권고 · 측정으로 확인해 주세요");
    expect(html).not.toContain("정상 참고권 · 확인 0항목");
    expect(state.analysis.m1_bridge.step).toBe("normal");
    expect(html).not.toContain("0.15");
    expect(html).toContain('data-bp-mode="lifestyle"');
  });

  it("analyzes the quarter demo immediately without loading or displaying any model result", () => {
    state.game = createDemoGame(
      "2026-11-02",
      Date.parse("2026-11-02T12:00:00Z"),
      quarterDemoPersona,
    );
    state.failed = true;
    const html = render({ period: "quarter" });
    expect(html).toContain("134 / 87 mmHg");
    expect(html).toContain("기록 90일 · 측정 180회");
    expect(html).toContain("선택 기간 평균");
    expect(html).toContain("초반 7개 기록일 → 최근 7개 기록일");
    expect(html).not.toContain("모델 결과");
    expect(state.hook).not.toHaveBeenCalled();
  });

  it("rejects research v9 output and never presents a no-reading normal diagnosis", () => {
    state.analysis = {
      m1: {
        model_version: "M1-ebm-repair-v9-cost150",
        feature_version: "1.2.0",
        data_quality: "ok",
        stage_top: "normal",
        risk_level: "normal",
        stage_probs: { normal: 1, elevated: 0, prehtn: 0, htn: 0 },
        reason_codes: ["sleep_short"],
      },
    } as QuestAnalysis;
    const html = render();
    expect(html).toContain("혈압을 측정해 기록해 주세요");
    expect(html).toContain("혈압 기록 없음은 정상 판정이 아니에요.");
    expect(html).not.toContain("짧은 수면");
    expect(html).not.toContain("정상 참고권");
    expect(html).not.toContain("v9");
  });

  it("uses entered undated measurements without using the placeholder or claiming a dated average", () => {
    expect(render()).toContain('data-bp-mode="lifestyle"');
    state.profileState = {
      hasProfileInput: true,
      hasBloodPressureInput: true,
      profile: { ...initialProfile, bloodPressure: "151 / 96" },
    };
    const html = render();
    expect(html).toContain("151 / 96 mmHg · 측정일 미확인");
    expect(html).toContain("기록 0일 · 측정 0회");
  });

  it("does not apply current lifestyle inference or future readings to a historical empty period", () => {
    const game = initialGame("2026-11-02");
    expect(render({ date: "2026-10-01" })).toContain('data-bp-mode="lifestyle"');
    expect(state.hook).not.toHaveBeenCalled();
    game.healthHistory[game.date] = { steps: null, sleepHours: null, systolic: 150, diastolic: 95 };
    state.game = game;
    const html = render({ period: "day", date: "2026-10-01" });
    expect(html).toContain("선택 기간 혈압 기록이 없어요");
    expect(html).not.toContain("150 / 95");
    expect(state.hook).not.toHaveBeenCalled();
  });
});
