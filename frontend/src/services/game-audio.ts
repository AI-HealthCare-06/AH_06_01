import { useEffect, useRef } from "react";
import { create } from "zustand";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { musicStep } from "./game-music";
export { mapMelodies } from "./game-music";
import { appStorageKey } from "../domain/demo-mode";
import type { EffectId } from "../domain/economy";
const key = appStorageKey("rexrun-game-audio");
function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
    return { bgm: raw.bgm !== false, sfx: raw.sfx !== false };
  } catch {
    return { bgm: true, sfx: true };
  }
}
export const useAudioStore = create<{
  bgm: boolean;
  sfx: boolean;
  set: (kind: "bgm" | "sfx", value: boolean) => void;
}>((set, get) => ({
  ...read(),
  set: (kind, value) => {
    set({ [kind]: value });
    try {
      localStorage.setItem(key, JSON.stringify({ bgm: get().bgm, sfx: get().sfx }));
    } catch {
      /* This session remains usable. */
    }
  },
}));
export function attackSoundPlan(dinosaur: number, effect: EffectId) {
  const root = [130, 190, 370, 100, 510, 250][dinosaur] ?? 190;
  const ratio = effect === "emerald" ? 1.5 : effect === "violet" ? 0.75 : 1;
  return {
    start: root * ratio,
    end: root * ratio * (dinosaur % 2 ? 0.35 : 2.2),
    type: (effect === "violet"
      ? "sawtooth"
      : effect === "emerald"
        ? "triangle"
        : dinosaur % 2
          ? "square"
          : "sine") as OscillatorType,
    duration: 0.12 + dinosaur * 0.018,
  };
}
type Options = {
  stage: number;
  dinosaur: number;
  effect: EffectId;
  attack: number | null;
  paused: boolean;
};
type Voice = { oscillator: OscillatorNode; kind: "bgm" | "sfx" };
export class GameAudioEngine {
  context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private voices = new Set<Voice>();
  private beat = 0;
  private nextStep = 0;
  private active = true;
  private settings = { bgm: true, sfx: true, stage: 1, paused: false };
  private createContext: () => AudioContext;
  constructor(createContext = () => new AudioContext()) {
    this.createContext = createContext;
  }
  async unlock() {
    if (!this.active || (!this.settings.bgm && !this.settings.sfx)) return;
    try {
      this.context ??= this.createContext();
      if (this.context.state === "suspended") await this.context.resume();
      this.sync();
    } catch {
      /* Autoplay remains silent until a valid gesture. */
    }
  }
  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      this.stop("bgm");
      this.stop("sfx");
    } else if (this.context) {
      void this.unlock();
    }
  }
  configure(settings: typeof this.settings) {
    const changed = settings.stage !== this.settings.stage;
    this.settings = settings;
    if (changed) {
      this.stop("bgm");
      this.beat = 0;
    }
    if (!settings.sfx || settings.paused) this.stop("sfx");
    this.sync();
  }
  private note(
    frequency: number,
    end: number,
    duration: number,
    type: OscillatorType,
    kind: "bgm" | "sfx",
    volume: number,
    at?: number,
  ) {
    const c = this.context;
    if (!c || c.state !== "running") return;
    const o = c.createOscillator(),
      g = c.createGain(),
      t = at ?? c.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(frequency, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + Math.min(0.008, duration / 4));
    if (kind === "bgm" && frequency === end)
      g.gain.setValueAtTime(volume * 0.72, t + duration * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g);
    g.connect(c.destination);
    const voice = { oscillator: o, kind };
    this.voices.add(voice);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
      this.voices.delete(voice);
    };
    o.start(t);
    o.stop(t + duration + 0.02);
  }
  playAttack(dinosaur: number, effect: EffectId) {
    if (
      !this.active ||
      !this.settings.sfx ||
      this.settings.paused ||
      document.visibilityState !== "visible"
    )
      return;
    const p = attackSoundPlan(dinosaur, effect);
    this.note(p.start, p.end, p.duration, p.type, "sfx", 0.18);
  }
  private stop(kind: "bgm" | "sfx") {
    for (const v of this.voices)
      if (v.kind === kind) {
        try {
          v.oscillator.stop();
        } catch {
          /* Already ended. */
        }
        this.voices.delete(v);
      }
    if (kind === "bgm" && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  sync() {
    if (
      !this.active ||
      !this.settings.bgm ||
      this.settings.paused ||
      document.visibilityState !== "visible" ||
      this.context?.state !== "running"
    ) {
      this.stop("bgm");
      if (document.visibilityState !== "visible") this.stop("sfx");
      return;
    }
    if (this.timer !== null) return;
    const c = this.context;
    this.nextStep = c.currentTime;
    const schedule = () => {
      // Schedule against the audio clock so animation/main-thread jitter does not change tempo.
      if (this.nextStep < c.currentTime - 0.1) this.nextStep = c.currentTime;
      while (this.nextStep < c.currentTime + 0.1) {
        const step = musicStep(this.settings.stage, this.beat++);
        for (const note of step.notes) {
          const frequency = 440 * 2 ** ((note.midi - 69) / 12);
          const end = 440 * 2 ** (((note.endMidi ?? note.midi) - 69) / 12);
          this.note(
            frequency,
            end,
            step.seconds * note.beats,
            note.type,
            "bgm",
            note.gain,
            this.nextStep,
          );
        }
        this.nextStep += step.seconds;
      }
    };
    schedule();
    this.timer = setInterval(schedule, 25);
  }

  dispose() {
    this.stop("bgm");
    this.stop("sfx");
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
export function useGameAudio(options: Options) {
  const { bgm, sfx } = useAudioStore();
  const engine = useRef<GameAudioEngine | null>(null);
  const last = useRef(options.attack);
  useEffect(() => {
    const audio = new GameAudioEngine();
    engine.current = audio;
    let active = true,
      disposed = false;
    const unlock = () => void audio.unlock();
    const sync = () => audio.setActive(active && document.visibilityState === "visible");
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", sync);
    // Android WebView may remain "visible" after the Activity moves to the background.
    const lifecycle = Capacitor.isNativePlatform()
      ? NativeApp.addListener("appStateChange", ({ isActive }) => {
          if (disposed) return;
          active = isActive;
          sync();
        })
      : null;
    if (lifecycle)
      void NativeApp.getState()
        .then(({ isActive }) => {
          if (!disposed) {
            active = isActive;
            sync();
          }
        })
        .catch(() => undefined);
    return () => {
      disposed = true;
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", sync);
      void lifecycle?.then((handle) => handle.remove()).catch(() => undefined);
      audio.dispose();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    engine.current?.configure({ bgm, sfx, stage: options.stage, paused: options.paused });
  }, [bgm, sfx, options.stage, options.paused]);
  useEffect(() => {
    if (options.attack !== null && options.attack !== last.current)
      engine.current?.playAttack(options.dinosaur, options.effect);
    last.current = options.attack;
  }, [options.attack, options.dinosaur, options.effect]);
}
