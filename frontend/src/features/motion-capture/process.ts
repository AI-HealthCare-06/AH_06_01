import { MotionDetector } from "./detector";
import { DrinkingDetector, drinkingConfig } from "./drinking";
import type { DetectionProgress, MotionQuest, ProcessObservation, ProcessTrace } from "./types";

export const processConfig = {
  version: "front-camera-process-v3.0",
  faceGraceMs: 1200,
  handToDrinkWindowMs: 30_000,
  pinchRatioMax: 0.45,
  hand: {
    qualitySlotMs: 200,
    maxAccumulationGapMs: 350,
    enterDistance: 0.28,
    leaveDistance: 0.85,
    medicineHoldMs: 450,
    stableMs: 400,
  },
  drink: drinkingConfig,
};

/** Recognizes visible action order, never pill identity, ingestion, or swallowed volume. */
export class ProcessDetector {
  private hand = new MotionDetector("medicine", true, processConfig.hand);
  private drink = new DrinkingDetector();
  private phase: "hand" | "drink" | "complete";
  private trace: ProcessTrace[] = [];
  private lastTimestamp: number | null = null;
  private faceSeenAt: number | null = null;
  private handFinishedAt: number | null = null;
  private lastStage = "";

  private quest: MotionQuest;
  private prepared: boolean;
  constructor(quest: MotionQuest, prepared: boolean) {
    this.quest = quest;
    this.prepared = prepared;
    this.phase = quest === "medicine" ? "hand" : "drink";
  }

  update(frame: ProcessObservation): DetectionProgress {
    const timestamp = frame.hand.timestamp;
    if (
      !Number.isFinite(timestamp) ||
      timestamp !== frame.drink.timestamp ||
      (this.lastTimestamp !== null && timestamp <= this.lastTimestamp)
    )
      return this.wrap({
        stage: "ready",
        holdProgress: 0,
        validObservationRatio: 0,
        message: "새 영상 프레임을 기다리고 있어요.",
      });
    if (this.phase === "complete")
      return this.wrap({
        stage: "detected",
        holdProgress: 1,
        validObservationRatio: 1,
        message: "과정 동작을 감지했어요.",
      });
    const frameGap =
      this.lastTimestamp !== null && timestamp - this.lastTimestamp > processConfig.faceGraceMs;
    this.lastTimestamp = timestamp;
    const faceVisible =
      frame.hand.mouth !== null && frame.hand.faceWidth !== null && frame.hand.faceWidth >= 40;
    const faceLost =
      this.faceSeenAt !== null && timestamp - this.faceSeenAt > processConfig.faceGraceMs;
    if (frameGap || faceLost || frame.hand.faceTrackingChanged || frame.drink.faceTrackingChanged) {
      this.reset();
      this.record("reset", timestamp);
    }
    if (faceVisible) this.faceSeenAt = timestamp;
    if (this.quest === "medicine" && !this.prepared)
      return this.wrap({
        stage: "ready",
        holdProgress: 0,
        validObservationRatio: 0,
        message: "경구 복약 과정 테스트 준비를 먼저 확인해 주세요.",
      });
    if (
      this.handFinishedAt !== null &&
      timestamp - this.handFinishedAt > processConfig.handToDrinkWindowMs
    ) {
      this.reset();
      this.record("sequence_timeout", timestamp);
    }
    let progress: DetectionProgress;
    if (this.phase === "hand") {
      const cupAtMouth =
        frame.drink.valid && frame.drink.distance !== null && frame.drink.distance < 0.45;
      const pinched =
        typeof frame.hand.pinchRatio === "number" &&
        frame.hand.pinchRatio >= 0 &&
        frame.hand.pinchRatio <= processConfig.pinchRatioMax;
      // A cup-holding hand, open palm, or a face touch alone must not finish this phase.
      progress = this.hand.update({
        ...frame.hand,
        valid: frame.hand.valid && pinched && !cupAtMouth,
        reason: cupAtMouth
          ? "컵보다 먼저, 약을 준비한 손의 동작을 확인해요."
          : !pinched
            ? "엄지와 검지로 집은 손과 얼굴이 함께 보이게 해 주세요."
            : frame.hand.reason,
      });
      if (progress.stage === "detected") {
        this.handFinishedAt = timestamp;
        this.phase = "drink";
        this.drink = new DrinkingDetector();
        this.record("hand_complete", timestamp);
        return this.wrap({
          ...progress,
          stage: "ready",
          holdProgress: 0,
          message: "손을 입으로 가져갔다 내리는 동작을 확인했어요. 다음은 컵을 아래에 보여 주세요.",
        });
      }
    } else {
      progress = this.drink.update(frame.drink);
      if (progress.stage === "detected") {
        this.phase = "complete";
        this.record("drink_complete", timestamp);
        progress = {
          ...progress,
          message:
            this.quest === "medicine"
              ? "손→입→손 내림과 컵으로 마시는 순서를 감지했어요."
              : "컵 접근→기울임→컵 내림 동작을 감지했어요.",
        };
      }
    }
    const marker = `${this.phase}:${progress.stage}`;
    if (marker !== this.lastStage) {
      this.record(marker, timestamp);
      this.lastStage = marker;
    }
    return this.wrap(progress);
  }

  private reset() {
    this.phase = this.quest === "medicine" ? "hand" : "drink";
    this.handFinishedAt = null;
    this.hand = new MotionDetector("medicine", true, processConfig.hand);
    this.drink = new DrinkingDetector();
    this.lastStage = "";
  }
  private record(event: string, timestamp: number) {
    this.trace.push({ event, timestamp });
    this.trace = this.trace.slice(-40);
  }
  private wrap(progress: DetectionProgress): DetectionProgress {
    return {
      ...progress,
      process: {
        phase: this.phase,
        completedSteps:
          this.phase === "complete"
            ? this.quest === "medicine"
              ? ["hand", "drink"]
              : ["drink"]
            : this.handFinishedAt !== null
              ? ["hand"]
              : [],
        trace: [...this.trace],
      },
    };
  }
}
