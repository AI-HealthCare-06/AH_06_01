import type { MotionObservation, MotionQuest } from "./types";
import { motionConfig } from "./config";

// Synthetic features exercise the same detector as camera input. They are never AI predictions.
export function sampleObservation(
  quest: MotionQuest,
  elapsedMs: number,
  timestamp: number,
): MotionObservation {
  const progress =
    elapsedMs < 900
      ? 0
      : elapsedMs < 1900
        ? (elapsedMs - 900) / 1000
        : elapsedMs < 3200
          ? 1
          : elapsedMs < 4200
            ? 1 - (elapsedMs - 3200) / 1000
            : 0;
  const mouth = { x: 0.5, y: 0.38 };
  const hand = { x: 0.7 - progress * 0.2, y: 0.8 - progress * 0.39 };
  const objectY = 0.61 - progress * 0.26;
  const object =
    quest === "water"
      ? { x: 0.38, y: objectY, width: 0.32, height: Math.min(0.42, 1 - objectY), label: "cup" }
      : null;
  const distance = object ? (Math.max(0, object.y - mouth.y) * 400) / 180 : 2.1 - progress * 1.95;
  return {
    frameWidth: 300,
    frameHeight: 400,
    timestamp,
    valid: true,
    reason: "샘플 좌표를 재생하고 있어요.",
    distance,
    objectAtMouth: quest === "water" && distance <= motionConfig.waterEnterDistance,
    trackingChanged: false,
    objectEvidence: quest === "water" ? "detected" : null,
    objectObservedAt: quest === "water" ? timestamp : null,
    objectOccluded: false,
    mouth,
    faceWidth: quest === "water" ? 180 : 80,
    hand: quest === "water" ? null : hand,
    object,
  };
}
