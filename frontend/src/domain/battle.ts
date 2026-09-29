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
