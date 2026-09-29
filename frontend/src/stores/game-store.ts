import { create } from "zustand";
import {
  applyDinosaurStyle,
  claimDailyBonus,
  completeQuest,
  initialGame,
  restoreGame,
  rollDay,
  syncDeviceSteps,
  collectBattleCoin,
} from "../domain/game";
import type { GameState, QuestId, StepSnapshot } from "../domain/game";
import type { SkinId } from "../domain/appearance";

const storageKey = "rexrun-demo-game-v1";
function loadGame() {
  try {
    return restoreGame(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
  } catch {
    return initialGame();
  }
}
function save(game: GameState) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(game));
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
  refreshDay: () => void;
  resetDemo: () => void;
  syncSteps: (snapshot: StepSnapshot) => void;
  collectCoin: (encounter: number) => void;
};

export const useGameStore = create<GameStore>((set) => ({
  game: loadGame(),
  paused: false,
  syncSteps: (snapshot) =>
    set((state) => {
      const game = syncDeviceSteps(state.game, snapshot);
      save(game);
      return { game };
    }),
  collectCoin: (encounter) =>
    set((state) => {
      const game = collectBattleCoin(state.game, encounter);
      save(game);
      return { game };
    }),
  complete: (id) =>
    set((state) => {
      const game = completeQuest(state.game, id);
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
      if (!Number.isInteger(index) || index < 0 || index > 5) return state;
      const game = { ...state.game, dinosaur: index };
      save(game);
      return { game };
    }),
  togglePause: () => set((state) => ({ paused: !state.paused })),
  customizeDinosaur: (index, skin) =>
    set((state) => {
      const game = applyDinosaurStyle(state.game, index, skin);
      save(game);
      return { game };
    }),
  refreshDay: () =>
    set((state) => {
      const game = rollDay(state.game);
      save(game);
      return { game };
    }),
  resetDemo: () => {
    const game = initialGame();
    save(game);
    set({ game, paused: false });
  },
}));
