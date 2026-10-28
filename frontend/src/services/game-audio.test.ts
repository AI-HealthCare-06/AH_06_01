import { afterEach, describe, expect, it, vi } from "vitest";
import { attackSoundPlan, GameAudioEngine, mapMelodies } from "./game-audio";
import { musicStep } from "./game-music";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup() {
  vi.useFakeTimers();
  vi.stubGlobal("document", { visibilityState: "visible" });
  const stop = vi.fn(),
    start = vi.fn();
  const createOscillator = vi.fn(() => ({
    type: "sine",
    frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start,
    stop,
    onended: null,
  }));
  const context = {
    state: "running",
    currentTime: 0,
    destination: {},
    createOscillator,
    createGain: () => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    close: vi.fn(async () => {}),
    resume: vi.fn(async () => {
      context.state = "running";
    }),
  };
  const factory = vi.fn(() => context as unknown as AudioContext);
  return { audio: new GameAudioEngine(factory), context, factory, createOscillator, start, stop };
}
describe("game audio", () => {
  it("has distinct palettes for six characters, three attack styles and six maps", () => {
    const plans = [0, 1, 2, 3, 4, 5].flatMap((d) =>
      (["original", "emerald", "violet"] as const).map((e) => attackSoundPlan(d, e)),
    );
    expect(new Set(plans.map((p) => JSON.stringify(p))).size).toBe(18);
    expect(plans.every((p) => p.start > 20 && p.end > 20 && p.duration < 0.3)).toBe(true);
    expect(new Set(mapMelodies.map((m) => m.join(","))).size).toBe(6);
  });
  it("loops complete phrases with rests, harmony and bounded mix headroom", () => {
    for (let stage = 1; stage <= 6; stage++) {
      expect(mapMelodies[stage - 1]).toHaveLength(64);
      expect(mapMelodies[stage - 1]).toContain(0);
      expect(musicStep(stage, 64)).toEqual(musicStep(stage, 0));
      for (let step = 0; step < 64; step++) {
        const plan = musicStep(stage, step);
        expect(plan.seconds).toBeGreaterThan(0.2);
        expect(plan.seconds).toBeLessThan(0.4);
        expect(plan.notes.reduce((sum, n) => sum + n.gain, 0)).toBeLessThan(0.4);
        expect(plan.notes.every((n) => n.midi >= 20 && n.midi <= 120 && n.beats > 0)).toBe(true);
      }
    }
  });
  it("stays silent before a gesture and disposes all output on OFF", async () => {
    const { audio, factory, createOscillator, stop, context } = setup();
    audio.configure({ stage: 1, bgm: true, sfx: true, paused: false });
    audio.playAttack(0, "original");
    expect(factory).not.toHaveBeenCalled();
    await audio.unlock();
    const musicCount = createOscillator.mock.calls.length;
    expect(musicCount).toBeGreaterThan(0);
    audio.playAttack(1, "emerald");
    expect(createOscillator.mock.calls.length).toBe(musicCount + 1);
    audio.configure({ stage: 1, bgm: false, sfx: false, paused: false });
    const count = createOscillator.mock.calls.length;
    audio.playAttack(1, "emerald");
    vi.advanceTimersByTime(2000);
    expect(createOscillator.mock.calls.length).toBe(count);
    expect(stop).toHaveBeenCalled();
    audio.dispose();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("silences background native activities even when WebView still reports visible, then resumes", async () => {
    const { audio, context, createOscillator, stop } = setup();
    await audio.unlock();
    audio.playAttack(0, "original");
    const count = createOscillator.mock.calls.length;
    audio.setActive(false);
    expect(stop).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    audio.playAttack(0, "original");
    await audio.unlock();
    vi.advanceTimersByTime(1500);
    expect(createOscillator.mock.calls.length).toBe(count);
    context.state = "suspended";
    audio.setActive(true);
    await Promise.resolve();
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(createOscillator.mock.calls.length).toBeGreaterThan(count);
    audio.configure({ stage: 1, bgm: true, sfx: true, paused: true });
    audio.setActive(false);
    audio.setActive(true);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    audio.dispose();
  });
  it("keeps BGM and SFX independent and avoids creating a context on foreground alone", async () => {
    const { audio, factory, createOscillator } = setup();
    audio.setActive(false);
    audio.setActive(true);
    expect(factory).not.toHaveBeenCalled();
    audio.configure({ stage: 2, bgm: false, sfx: true, paused: false });
    await audio.unlock();
    expect(createOscillator).not.toHaveBeenCalled();
    audio.playAttack(3, "violet");
    expect(createOscillator).toHaveBeenCalledTimes(1);
    audio.configure({ stage: 2, bgm: true, sfx: false, paused: false });
    const music = createOscillator.mock.calls.length;
    expect(music).toBeGreaterThan(1);
    audio.playAttack(3, "violet");
    expect(createOscillator.mock.calls.length).toBe(music);
    audio.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
