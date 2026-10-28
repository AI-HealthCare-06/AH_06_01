import type { InjectionObservation } from "./injection";

export type MotionQuest = "water" | "medicine";
export type InputSource = "camera" | "sample";
export type Point = { x: number; y: number };
export type ObjectBox = Point & { width: number; height: number; label: string };
export type ProcessTrace = { event: string; timestamp: number };
export type ProcessProgress = {
  phase: "hand" | "drink" | "injection" | "complete";
  completedSteps: string[];
  trace: ProcessTrace[];
};
export type ProcessObservation = { hand: MotionObservation; drink: MotionObservation };
export type MotionStage =
  "ready" | "approaching" | "at_mouth" | "at_site" | "returning" | "detected";
export type MotionObservation = {
  frameWidth: number;
  frameHeight: number;
  timestamp: number;
  valid: boolean;
  reason: string;
  distance: number | null;
  objectAtMouth: boolean;
  pinchRatio?: number;
  faceTrackingChanged?: boolean;
  trackingChanged: boolean;
  mouth: Point | null;
  faceWidth: number | null;
  hand: Point | null;
  object: ObjectBox | null;
  objectEvidence: "detected" | "tracked" | null;
  objectObservedAt: number | null;
  objectOccluded: boolean;
};
export type DetectionProgress = {
  stage: MotionStage;
  process?: ProcessProgress;
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
  kind:
    | "drinking_motion"
    | "hand_to_mouth_motion"
    | "oral_medication_process"
    | "injection_site_hand_process"
    | null;
  decision: "detected" | "inconclusive" | "cancelled";
  detector: "rules_v1" | "process_rules_v2" | "injection_rules_v1";
  process?: ProcessProgress;
  modelManifestVersion: string;
  configVersion: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  validObservationRatio: number;
  classificationScore: null;
  preparationSource: "not_required" | "user_ack";
  verificationLevel: "local_demo" | "experimental_process";
  userConfirmed: boolean;
  reasonCodes: string[];
};
export type WorkerRequest =
  | {
      type: "init";
      sessionId: string;
      quest: MotionQuest;
      baseUrl: string;
      process?: boolean;
      injection?: boolean;
    }
  | { type: "frame"; sessionId: string; image: ImageBitmap; timestamp: number };
export type WorkerResponse =
  | { type: "ready"; sessionId: string }
  | { type: "loading"; sessionId: string; message: string }
  | {
      type: "observation";
      sessionId: string;
      observation: MotionObservation;
      process?: ProcessObservation;
      injection?: InjectionObservation;
      latencyMs: number;
    }
  | { type: "error"; sessionId: string; message: string };
