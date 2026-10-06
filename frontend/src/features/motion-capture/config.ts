export const motionConfig = {
  version: "rules-v1.1",
  frameIntervalMs: 100,
  objectIntervalMs: 200,
  objectMaxAgeMs: 500,
  objectAcquireScore: 0.4,
  objectContinueScore: 0.25,
  objectOcclusionMs: 1500,
  waterMaxGapMs: 900,
  waterEnterDistance: 0.4,
  waterLeaveDistance: 0.8,
  timeoutMs: 20_000,
  loadingTimeoutMs: 45_000,
  maxGapMs: 500,
  maxAccumulationGapMs: 250,
  stableMs: 300,
  enterDistance: 0.6,
  leaveDistance: 1,
  waterHoldMs: 700,
  medicineHoldMs: 250,
  minimumValidRatio: 0.8,
};

export const manifestVersion = "mediapipe-1.0.1-models-v1";
