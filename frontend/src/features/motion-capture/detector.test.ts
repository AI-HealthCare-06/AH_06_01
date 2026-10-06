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

describe("motion sequence acceptance", () => {
  it.each(["water", "medicine"] as const)(
    "accepts a full %s approach, hold and return",
    (quest) => {
      const { advance } = sequence(quest);
      expect(advance(1.8, 5).stage).toBe("approaching");
      expect(advance(0.2, 10).stage).toBe("returning");
      expect(advance(1.8, 4).stage).toBe("detected");
      expect(advance(0.2, 10).stage).toBe("detected");
    },
  );

  it("does not accept a clip that starts at the mouth", () => {
    const { advance } = sequence("water");
    expect(advance(0.1, 15).stage).toBe("ready");
    expect(advance(2, 5).stage).toBe("approaching");
  });

  it("does not classify face touching as drinking without a cup at the mouth", () => {
    const { advance } = sequence("water");
    advance(2, 5);
    expect(advance(0.2, 15, { objectAtMouth: false }).stage).toBe("approaching");
    expect(advance(2, 5).stage).not.toBe("detected");
  });

  it("requires medication preparation acknowledgement", () => {
    const { advance } = sequence("medicine", false);
    advance(2, 5);
    advance(0.2, 10);
    expect(advance(2, 5).stage).toBe("ready");
  });

  it("bridges a drinking hold but requires the cup to be observed again before completion", () => {
    const { advance } = sequence("water");
    advance(2, 5);
    expect(advance(0.2, 9, { objectEvidence: "tracked" }).stage).toBe("returning");
    expect(advance(2, 4, { objectEvidence: "tracked" }).stage).toBe("returning");
    expect(advance(2, 1, { objectEvidence: "detected" }).stage).toBe("detected");
  });

  it("rejects a brief pass by the mouth", () => {
    const { advance } = sequence("water");
    advance(2, 5);
    advance(0.2, 1);
    expect(advance(2, 5).stage).not.toBe("detected");
  });

  it("does not fill hold time with a missing observation interval", () => {
    const { detector, advance, nextTime } = sequence("water");
    advance(2, 5);
    advance(0.2, 3);
    expect(detector.update(observation(nextTime() + 1000, 0.2)).stage).toBe("ready");
  });

  it("starts over when the tracked person or hand changes", () => {
    const { advance } = sequence("water");
    advance(2, 5);
    advance(0.2, 10);
    expect(advance(2, 1, { trackingChanged: true }).stage).toBe("ready");
    expect(advance(2, 2).stage).toBe("ready");
  });

  it("ignores out of order timestamps", () => {
    const { detector, advance } = sequence("water");
    advance(2, 5);
    advance(0.2, 10);
    expect(detector.update(observation(100, 2)).stage).toBe("returning");
  });

  it("treats non-finite distances as missing observations", () => {
    const { advance } = sequence("water");
    advance(2, 5);
    advance(0.2, 10);
    const invalid = advance(Number.NaN, 10);
    expect(invalid.validObservationRatio).toBeLessThan(0.8);
    expect(advance(2, 3).stage).not.toBe("detected");
  });

  it("rejects long invalid observation gaps rather than reusing a candidate", () => {
    const { advance } = sequence("water");
    advance(2, 5);
    advance(0.2, 10);
    advance(2, 10, { valid: false });
    expect(advance(2, 3).stage).not.toBe("detected");
  });
});
