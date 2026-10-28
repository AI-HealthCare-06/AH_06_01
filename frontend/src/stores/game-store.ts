import { appStorageKey } from "../domain/demo-mode";
import { create } from "zustand";
import {
  startProfileQuests,
  completeProfileQuest,
  type ProfileQuestId,
} from "../domain/profile-quests";
import {
  recordDailySurvey,
  awardSleepExperience,
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
import { useSessionStore } from "./session-store";
import { useMedicationStore } from "./medication-store";
import { dailyDoses } from "../domain/medications";
import { localDate } from "../domain/calendar";
import { questVerified } from "../domain/quest-verification";
import { useQuestVerificationStore } from "./quest-verification-store";

import { cacheDailySurveyGame, clearDailySurveyGame } from "../services/daily-survey-cache";

const storageKey = appStorageKey("rexrun-demo-game-v1");
function loadGame() {
  try {
    const restored = restoreGame(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
    return useSessionStore.getState().active
      ? tickBattle(restored)
      : { ...restored, battlePaused: true, battleUpdatedAt: Date.now() };
  } catch {
    return initialGame();
  }
}
function save(game: GameState) {
  const accountSaved = cacheDailySurveyGame(game);
  if (accountSaved === false) return false;
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify(game, (key, value) => (key === "debugBuffs" ? undefined : value)),
    );
    return true;
  } catch {
    return accountSaved === true;
  }
}

type GameStore = {
  game: GameState;
  startProfileQuests: (now?: number, legacy?: boolean) => void;
  finishProfileQuest: (id: ProfileQuestId) => number | null;
  paused: boolean;
  complete: (id: QuestId) => boolean;
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
  recordSleep: (minutes: number, date: string) => void;
  recordSurvey: (value: unknown) => boolean;
  tick: () => void;
  suspendSession: () => void;
  resumeSession: () => void;
  convertRp: (amount: number) => void;
  repeat: (id: QuestId) => boolean;
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
  startProfileQuests: (now = Date.now(), legacy = false) =>
    set((state) => {
      const game = startProfileQuests(state.game, now, legacy);
      if (game === state.game || !save(game)) return state;
      return { game };
    }),
  finishProfileQuest: (id) => {
    let reward: number | null = null;
    set((state) => {
      if (!useSessionStore.getState().active) return state;
      const game = completeProfileQuest(state.game, id, Date.now());
      if (game === state.game || !save(game)) return state;
      reward = game.profileQuests.completed[id]!.experience;
      return { game };
    });
    return reward;
  },
  suspendSession: () =>
    set((state) => {
      const game = { ...state.game, battlePaused: true, battleUpdatedAt: Date.now() };
      save(game);
      return { game, paused: true };
    }),
  resumeSession: () =>
    set((state) => {
      const game = { ...state.game, battlePaused: false, battleUpdatedAt: Date.now() };
      save(game);
      return { game, paused: false };
    }),
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
      if (!useSessionStore.getState().active) return state;
      const game = syncDeviceSteps(tickBattle(state.game), snapshot);
      save(game);
      return { game };
    }),
  recordSurvey: (value) => {
    let stored = false;
    set((state) => {
      if (!useSessionStore.getState().active) return state;
      const current = tickBattle(state.game);
      const game = recordDailySurvey(current, value);
      if (game === current) return state;
      if (!save(game)) return state;
      stored = true;
      return { game };
    });
    return stored;
  },
  recordSleep: (minutes, date) =>
    set((state) => {
      if (
        !useSessionStore.getState().active ||
        date !== localDate() ||
        !Number.isInteger(minutes) ||
        minutes <= 0 ||
        minutes > 1440
      )
        return state;
      const current = tickBattle(state.game);
      const sleepHours = minutes / 60;
      const game = awardSleepExperience(
        {
          ...current,
          sleepHours,
          healthHistory: {
            ...current.healthHistory,
            [date]: {
              ...current.healthHistory[date],
              steps: current.steps?.count ?? null,
              sleepHours,
            },
          },
        },
        sleepHours,
        date,
      );
      save(game);
      return { game };
    }),
  tick: () =>
    set((state) => {
      if (!useSessionStore.getState().active) return state;
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
  repeat: (id) => {
    let rewarded = false;
    set((state) => {
      if (
        !useSessionStore.getState().active ||
        !questVerified(state.game, id, useQuestVerificationStore.getState().proofs[id])
      )
        return state;
      const game = repeatDemoQuest(tickBattle(state.game), id);
      if ((game.activity[id] ?? 0) === (state.game.activity[id] ?? 0)) return state;
      if (!useQuestVerificationStore.getState().consume(id)) return state;
      rewarded = true;
      save(game);
      return { game };
    });
    return rewarded;
  },
  buyEffect: (id) =>
    set((state) => {
      const game = purchaseEffect(tickBattle(state.game), id);
      save(game);
      return { game };
    }),
  complete: (id) => {
    let rewarded = false;
    set((state) => {
      if (!useSessionStore.getState().active) return state;
      const { medications, taken } = useMedicationStore.getState();
      const proof = useQuestVerificationStore.getState().proofs[id];
      if (!questVerified(state.game, id, proof, dailyDoses(medications, localDate(), taken)))
        return state;
      const current = tickBattle(state.game);
      if (current.completed.includes(id)) return state;
      const game = completeQuest(
        id === "sleep" ? { ...current, sleepHours: proof!.minutes! / 60 } : current,
        id,
      );
      if (!game.completed.includes(id)) return state;
      if (
        id !== "medicine" &&
        id !== "walk" &&
        id !== "survey" &&
        !useQuestVerificationStore.getState().consume(id)
      )
        return state;
      rewarded = true;
      save(game);
      return { game };
    });
    return rewarded;
  },
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
      if (!useSessionStore.getState().active) return state;
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
      if (!useSessionStore.getState().active) return state;
      const game = rollDay(tickBattle(state.game));
      save(game);
      return { game };
    }),
  resetDemo: () => {
    clearDailySurveyGame();
    const game = initialGame();
    save(game);
    set({ game, paused: false });
  },
}));
