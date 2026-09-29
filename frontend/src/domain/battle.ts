import type { QuestId } from "./game";

export const questBuffs: { id: QuestId; label: string; effect: string }[] = [
  { id: "medicine", label: "복약", effect: "최대 HP +20" },
  { id: "meal", label: "식사", effect: "공격 속도 +15%" },
  { id: "walk", label: "걷기", effect: "이동 속도 +20%" },
  { id: "water", label: "수분", effect: "처치 코인 +2" },
  { id: "sleep", label: "수면", effect: "최대 HP +40" },
];

export function battleBuffStats(completed: readonly QuestId[]) {
  return {
    maxHp: 320 + (completed.includes("medicine") ? 20 : 0) + (completed.includes("sleep") ? 40 : 0),
    attackSpeed: completed.includes("meal") ? 1.15 : 1,
    moveSpeed: completed.includes("walk") ? 1.2 : 1,
    coinReward: completed.includes("water") ? 12 : 10,
  };
}

// Stage n needs 10+n defeats; ten substages form one world/background.
// Keep the persisted lifetime defeat count so existing saves retain all progress.
export function battleStage(defeats: number) {
  const total = Math.max(0, Math.floor(defeats));
  const index = Math.floor((Math.sqrt(361 + 8 * total) - 19) / 2);
  return {
    world: Math.floor(index / 10) + 1,
    substage: (index % 10) + 1,
    target: 10 + index,
    progress: total - (index * (index + 19)) / 2,
  };
}

export const battleDurations = {
  spawn: 640,
  idle: 960,
  attack: 960,
  defeat: 400,
  drop: 720,
  move: 1120,
};
export type BattlePhase = keyof typeof battleDurations;
export type BattleState = { phase: BattlePhase; elapsed: number; encounter: number; enemy: number };
const phases: BattlePhase[] = ["spawn", "idle", "attack", "defeat", "drop", "move"];
export function advanceBattle(state: BattleState, delta: number, nextEnemy: number): BattleState {
  const elapsed = state.elapsed + delta;
  if (elapsed < battleDurations[state.phase]) return { ...state, elapsed };
  if (state.phase === "move")
    return { phase: "spawn", elapsed: 0, encounter: state.encounter + 1, enemy: nextEnemy };
  return { ...state, phase: phases[phases.indexOf(state.phase) + 1], elapsed: 0 };
}
