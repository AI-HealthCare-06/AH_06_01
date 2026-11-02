import { describe, expect, it } from "vitest";
import { MotionDetector } from "./detector";
import type { MotionObservation, MotionQuest } from "./types";

const observation = (
  timestamp: number,
  distance: number,
  overrides: Partial<MotionObservation> = {},
): MotionObservation => ({
  frameWidth: 640,
  frameHeight: 480,
  timestamp,
  distance,
  valid: true,
  reason: "",
  objectAtMouth: distance <= 0.6,
  trackingChanged: false,
  mouth: null,
  faceWidth: null,
  hand: null,
  object: null,
  objectEvidence: "detected",
  objectObservedAt: timestamp,
  objectOccluded: false,
  ...overrides,
});
function sequence(quest: MotionQuest, acknowledged = true) {
  const detector = new MotionDetector(quest, acknowledged);
  let timestamp = 0;
  const advance = (distance: number, count: number, overrides: Partial<MotionObservation> = {}) => {
    let result = detector.update(observation(timestamp, distance, overrides));
    for (let index = 0; index < count; index++) {
      timestamp += 100;
      result = detector.update(observation(timestamp, distance, overrides));
    }
    return result;
  };
  return { detector, advance, nextTime: () => timestamp + 100 };
}

describe("medicine hand motion", () => {
  it("accepts a prepared approach and withdrawal", () => {
    const { advance } = sequence("medicine");
    expect(advance(1.8, 5).stage).toBe("approaching");
    expect(advance(0.2, 10).stage).toBe("returning");
    expect(advance(1.8, 4).stage).toBe("detected");
  });
  it("requires preparation acknowledgement", () => {
    const { advance } = sequence("medicine", false);
    advance(1.8, 5);
    advance(0.2, 10);
    expect(advance(1.8, 4).stage).not.toBe("detected");
  });
  it("discards interrupted tracking and stale timestamps", () => {
    const { advance, detector } = sequence("medicine");
    advance(1.8, 5);
    advance(0.2, 10);
    expect(detector.update(observation(100, 2)).stage).toBe("returning");
    expect(advance(2, 1, { trackingChanged: true }).stage).toBe("ready");
  });
  it("rejects invalid or too-sparse input", () => {
    const { advance } = sequence("medicine");
    advance(1.8, 5);
    advance(0.2, 10);
    advance(2, 10, { valid: false });
    expect(advance(2, 3).stage).not.toBe("detected");
  });
  it("routes water to the dynamic detector, never to presence-and-hold rules", () => {
    const { advance } = sequence("water");
    advance(2, 5);
    advance(0.1, 50);
    expect(advance(2, 5).stage).not.toBe("detected");
  });
});
