import { describe, it, expect } from "vitest";
import { DrinkingDetector } from "./drinking";
import type { MotionObservation } from "./types";

function frame(
  t: number,
  distance: number,
  angle: number | null = 20,
  extra: Partial<MotionObservation> = {},
): MotionObservation {
  return {
    timestamp: t,
    frameWidth: 480,
    frameHeight: 640,
    valid: true,
    distance,
    reason: "",
    objectAtMouth: distance <= 0.2,
    trackingChanged: false,
    mouth: { x: 0.5, y: 0.4 },
    faceWidth: 150,
    hand: { x: 0.5, y: 0.6 },
    object: { x: 0.4, y: 0.5, width: 0.2, height: 0.25, label: "cup" },
    objectEvidence: "detected",
    objectObservedAt: t,
    objectOccluded: false,
    drinkMotion: { handInclination: angle, aspect: 0.8, lift: -0.4 },
    ...extra,
  };
}
const prepare = (d: DrinkingDetector) => [0, 100, 200].forEach((t) => d.update(frame(t, 0.6)));
describe("dynamic visible drinking cycle", () => {
  it("uses palm rotation when the longitudinal hand axis barely changes", () => {
    const d = new DrinkingDetector();
    prepare(d);
    d.update(
      frame(300, 0.1, 20, {
        drinkMotion: {
          handInclination: 20,
          aspect: 0.8,
          lift: -0.4,
          palmNormal: { x: 0, y: 0, z: 1 },
        },
      }),
    );
    const tilted = {
      drinkMotion: {
        handInclination: 22,
        aspect: 0.8,
        lift: -0.2,
        palmNormal: { x: 0, y: 0.5, z: Math.sqrt(0.75) },
      },
    };
    d.update(frame(400, 0.1, 22, tilted));
    expect(d.update(frame(500, 0.1, 22, tilted)).stage).toBe("returning");
    const lowered = {
      valid: false,
      object: null,
      objectEvidence: null,
      trackingChanged: true,
      hand: { x: 0.5, y: 0.7 },
    } as const;
    d.update(frame(600, 0.6, 20, lowered));
    expect(d.update(frame(700, 0.6, 20, lowered)).stage).toBe("detected");
  });
  it("does not finish a tipped cycle when both cup and hand vanish or the face changes", () => {
    for (const changedFace of [false, true]) {
      const d = new DrinkingDetector();
      prepare(d);
      d.update(frame(300, 0.1));
      d.update(frame(400, 0.1, 45));
      d.update(frame(500, 0.1, 45));
      const lost = {
        valid: false,
        object: null,
        objectEvidence: null,
        hand: changedFace ? { x: 0.5, y: 0.7 } : null,
        trackingChanged: true,
        faceTrackingChanged: changedFace,
      } as const;
      d.update(frame(600, 0.6, 20, lost));
      expect(d.update(frame(700, 0.6, 20, lost)).stage).not.toBe("detected");
    }
  });
  it("accepts a natural short tip and withdrawal without a long mouth hold", () => {
    const d = new DrinkingDetector();
    prepare(d);
    d.update(frame(300, 0.1));
    d.update(frame(400, 0.1, 36));
    expect(d.update(frame(500, 0.1, 40)).stage).toBe("returning");
    d.update(frame(600, 0.6));
    expect(d.update(frame(700, 0.6)).stage).toBe("detected");
  });
  it("rejects holding a cup at the mouth for seconds without tipping", () => {
    const d = new DrinkingDetector();
    prepare(d);
    for (let t = 300; t < 3500; t += 100) d.update(frame(t, 0.1));
    for (let t = 3500; t < 4000; t += 100)
      expect(d.update(frame(t, 0.6)).stage).not.toBe("detected");
  });
  it("does not confuse hand rotation during the initial lift with subsequent drinking", () => {
    const d = new DrinkingDetector();
    prepare(d);
    for (let t = 300; t < 1500; t += 100) d.update(frame(t, 0.1, 65));
    for (let t = 1500; t < 1900; t += 100)
      expect(d.update(frame(t, 0.6, 65)).stage).not.toBe("detected");
  });
  it("rejects a pass by the mouth and observation jitter", () => {
    const d = new DrinkingDetector();
    prepare(d);
    d.update(frame(300, 0.1));
    expect(d.update(frame(400, 0.6, 60)).stage).not.toBe("detected");
    const jitter = new DrinkingDetector();
    prepare(jitter);
    for (let t = 300; t < 1800; t += 100) jitter.update(frame(t, 0.1, 20 + (t % 200 ? 2 : -2)));
    for (let t = 1800; t < 2200; t += 100)
      expect(jitter.update(frame(t, 0.6)).stage).not.toBe("detected");
  });
  it("can use independently detected cup shape and lift when the wrist is cropped", () => {
    const d = new DrinkingDetector();
    prepare(d);
    d.update(frame(300, 0.1, null));
    const tipped = { drinkMotion: { handInclination: null, aspect: 1.2, lift: -0.1 } };
    d.update(frame(600, 0.1, null, tipped));
    d.update(frame(700, 0.1, null, { ...tipped, objectEvidence: "tracked" }));
    expect(d.update(frame(900, 0.1, null, tipped)).stage).toBe("returning");
    d.update(frame(1000, 0.6, null));
    expect(d.update(frame(1100, 0.6, null)).stage).toBe("detected");
  });
  it("rejects repeated timestamps or interrupted tracking", () => {
    const d = new DrinkingDetector();
    prepare(d);
    d.update(frame(300, 0.1));
    for (let i = 0; i < 50; i++) d.update(frame(400, 0.1, 45));
    expect(d.update(frame(500, 0.6)).stage).not.toBe("detected");
    const interrupted = new DrinkingDetector();
    prepare(interrupted);
    interrupted.update(frame(300, 0.1));
    interrupted.update(frame(400, 0.1, 40));
    interrupted.update(frame(500, 0.1, 40));
    expect(interrupted.update(frame(1500, 0.6)).stage).not.toBe("detected");
  });
  it("does not join isolated tipping frames across a stalled camera", () => {
    const d = new DrinkingDetector();
    prepare(d);
    d.update(frame(300, 0.1));
    d.update(frame(400, 0.1, 45));
    d.update(frame(900, 0.1, 45));
    d.update(frame(1000, 0.6));
    expect(d.update(frame(1100, 0.6)).stage).not.toBe("detected");
  });
});
