export type MotionQuest = "water" | "medicine";
export type InputSource = "camera" | "sample";
export type Point = { x: number; y: number };
export type ObjectBox = Point & { width: number; height: number; label: string };
export type MotionStage = "ready" | "approaching" | "at_mouth" | "returning" | "detected";
export type MotionObservation = {
  frameWidth: number;
  frameHeight: number;
  timestamp: number;
  valid: boolean;
  reason: string;
  distance: number | null;
  objectAtMouth: boolean;
  trackingChanged: boolean;
  mouth: Point | null;
  hand: Point | null;
  object: ObjectBox | null;
  objectEvidence: "detected" | "tracked" | null;
  objectObservedAt: number | null;
  objectOccluded: boolean;
};
export type DetectionProgress = {
  stage: MotionStage;
  holdProgress: number;
  validObservationRatio: number;
  message: string;
};
export type MotionResult = {
  schemaVersion: 1;
  sessionId: string;
  eventId: string | null;
  questId: MotionQuest;
  inputSource: InputSource;
  kind: "drinking_motion" | "hand_to_mouth_motion" | null;
  decision: "detected" | "inconclusive" | "cancelled";
  detector: "rules_v1";
  modelManifestVersion: string;
  configVersion: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  validObservationRatio: number;
  classificationScore: null;
  preparationSource: "not_required" | "user_ack";
  verificationLevel: "local_demo";
  userConfirmed: boolean;
  reasonCodes: string[];
};
export type WorkerRequest =
  | { type: "init"; sessionId: string; quest: MotionQuest; baseUrl: string }
  | { type: "frame"; sessionId: string; image: ImageBitmap; timestamp: number };
export type WorkerResponse =
  | { type: "ready"; sessionId: string }
  | { type: "loading"; sessionId: string; message: string }
  | { type: "observation"; sessionId: string; observation: MotionObservation; latencyMs: number }
  | { type: "error"; sessionId: string; message: string };
