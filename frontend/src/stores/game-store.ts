import { create } from "zustand";
import {
  applyDinosaurStyle,
  selectDinosaur,
  claimDailyBonus,
  completeQuest,
  initialGame,
  restoreGame,
  rollDay,
  syncDeviceSteps,
  tickBattle,
  convertDemoRp,
  repeatDemoQuest,
  purchaseEffect,
  purchaseAccessory,
  equipAccessory,
  selectBattleLocation,
  retryBattle,
} from "../domain/game";
import type { GameState, QuestId, StepSnapshot } from "../domain/game";
import type { SkinId } from "../domain/appearance";
import type { EffectId } from "../domain/economy";
import { experienceForLevel, experienceProgress } from "../domain/experience";
import { characterStats } from "../domain/game-policy";
import { debugBuffLimits, type DebugBuffs } from "../domain/battle";

const storageKey = "rexrun-demo-game-v1";
function loadGame() {
  try {
    return tickBattle(restoreGame(JSON.parse(localStorage.getItem(storageKey) ?? "null")));
  } catch {
    return initialGame();
  }
}
function save(game: GameState) {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify(game, (key, value) => (key === "debugBuffs" ? undefined : value)),
    );
  } catch {
    /* The demo also works without persistent browser storage. */
  }
}

type GameStore = {
  game: GameState;
  paused: boolean;
  complete: (id: QuestId) => void;
  claimBonus: () => void;
  chooseDinosaur: (index: number) => void;
  customizeDinosaur: (index: number, skin: SkinId) => void;
  togglePause: () => void;
  selectBattle: (stage: number, wave: number) => void;
  setWaveAutoRestart: (enabled: boolean) => void;
  setBattleDisplaySetting: (
    key: "showBattleDamage" | "showMonsterHealth",
    enabled: boolean,
  ) => void;
  retryWave: () => void;
  refreshDay: () => void;
  resetDemo: () => void;
  syncSteps: (snapshot: StepSnapshot) => void;
  tick: () => void;
  convertRp: (amount: number) => void;
  repeat: (id: QuestId) => void;
  buyEffect: (id: EffectId) => void;
  debugChangeLevel: (delta: number) => void;
  debugSetBuff: (key: keyof DebugBuffs, value: number) => void;
  debugResetBuffs: () => void;
  buyAccessory: (id: string) => boolean;
  equipAccessory: (id: string) => void;
};

const loadedGame = loadGame();
save(loadedGame);
let lastSaved = 0;
export const useGameStore = create<GameStore>((set) => ({
  game: loadedGame,
  paused: loadedGame.battlePaused,
  setWaveAutoRestart: (enabled) =>
    set((state) => {
      const game = { ...tickBattle(state.game), waveAutoRestart: enabled };
      save(game);
      return { game };
    }),
  setBattleDisplaySetting: (key, enabled) =>
    set((state) => {
      const game = { ...tickBattle(state.game), [key]: enabled };
      save(game);
      return { game };
    }),
  retryWave: () =>
    set((state) => {
      const game = retryBattle(state.game);
      save(game);
      return { game };
    }),
  selectBattle: (stage, wave) =>
    set((state) => {
      const game = selectBattleLocation(state.game, stage, wave);
      if (game === state.game) return state;
      save(game);
      return { game };
    }),
  debugSetBuff: (key, value) =>
    set((state) => {
      if (!import.meta.env.DEV || !Number.isFinite(value) || !Object.hasOwn(debugBuffLimits, key))
        return state;
      const [min, max] = debugBuffLimits[key];
      return {
        game: {
          ...tickBattle(state.game),
          debugBuffs: { ...state.game.debugBuffs, [key]: Math.max(min, Math.min(max, value)) },
        },
      };
    }),
  debugResetBuffs: () =>
    set((state) =>
      import.meta.env.DEV ? { game: { ...tickBattle(state.game), debugBuffs: undefined } } : state,
    ),
  buyAccessory: (id) => {
    let purchased = false;
    set((state) => {
      const current = tickBattle(state.game);
      const game = purchaseAccessory(current, id);
      purchased = game !== current;
      save(game);
      return { game };
    });
    return purchased;
  },
  equipAccessory: (id) =>
    set((state) => {
      const game = equipAccessory(state.game, id);
      save(game);
      return { game };
    }),
  debugChangeLevel: (delta) =>
    set((state) => {
      if (!import.meta.env.DEV || ![1, -1].includes(delta)) return state;
      const level = Math.max(
        1,
        Math.min(100, experienceProgress(state.game.experience).level + delta),
      );
      const game = {
        ...state.game,
        experience: experienceForLevel(level),
        battleUpdatedAt: Date.now(),
        combat: { ...state.game.combat, hp: characterStats(level).hp, recovery: 0 },
      };
      save(game);
      return { game };
    }),
  syncSteps: (snapshot) =>
    set((state) => {
      const game = syncDeviceSteps(tickBattle(state.game), snapshot);
      save(game);
      return { game };
    }),
  tick: () =>
    set((state) => {
      const game = tickBattle(state.game);
      if (
        game.experience !== state.game.experience ||
        game.gold !== state.game.gold ||
        game.combat.pendingGold !== state.game.combat.pendingGold ||
        game.combat.lastFailure?.time !== state.game.combat.lastFailure?.time ||
        Date.now() - lastSaved >= 1000
      ) {
        save(game);
        lastSaved = Date.now();
      }
      return { game };
    }),
  convertRp: (amount) =>
    set((state) => {
      const game = convertDemoRp(tickBattle(state.game), amount);
      save(game);
      return { game };
    }),
  repeat: (id) =>
    set((state) => {
      const game = repeatDemoQuest(tickBattle(state.game), id);
      save(game);
      return { game };
    }),
  buyEffect: (id) =>
    set((state) => {
      const game = purchaseEffect(tickBattle(state.game), id);
      save(game);
      return { game };
    }),
  complete: (id) =>
    set((state) => {
      const game = completeQuest(tickBattle(state.game), id);
      save(game);
      return { game };
    }),
  claimBonus: () =>
    set((state) => {
      const game = claimDailyBonus(state.game);
      save(game);
      return { game };
    }),
  chooseDinosaur: (index) =>
    set((state) => {
      const game = selectDinosaur(state.game, index);
      if (game === state.game) return state;
      save(game);
      return { game };
    }),
  togglePause: () =>
    set((state) => {
      const game = { ...tickBattle(state.game), battlePaused: !state.paused };
      save(game);
      return { paused: game.battlePaused, game };
    }),
  customizeDinosaur: (index, skin) =>
    set((state) => {
      const game = applyDinosaurStyle(state.game, index, skin);
      save(game);
      return { game };
    }),
  refreshDay: () =>
    set((state) => {
      const game = rollDay(tickBattle(state.game));
      save(game);
      return { game };
    }),
  resetDemo: () => {
    const game = initialGame();
    save(game);
    set({ game, paused: false });
  },
}));
