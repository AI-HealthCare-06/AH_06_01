import { sampleObservation } from "./sample";
import type { MotionQuest, ProcessObservation } from "./types";

export function sampleProcess(
  quest: MotionQuest,
  elapsed: number,
  timestamp: number,
): ProcessObservation {
  const hand = {
    ...sampleObservation("medicine", quest === "medicine" ? elapsed : 0, timestamp),
    pinchRatio: 0.2,
  };
  const drink = sampleObservation(
    "water",
    quest === "medicine" ? Math.max(0, elapsed - 4800) : elapsed,
    timestamp,
  );
  return { hand, drink };
}
