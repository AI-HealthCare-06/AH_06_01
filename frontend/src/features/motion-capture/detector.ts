import { motionConfig as config } from "./config";
import type { DetectionProgress, MotionObservation, MotionQuest, MotionStage } from "./types";

export class MotionDetector {
  private quest: MotionQuest;
  private preparationAcknowledged: boolean;
  private stage: MotionStage = "ready";
  private heldMs = 0;
  private previousTimestamp: number | null = null;
  private previousValid = false;
  private lastValidAt: number | null = null;
  private firstTimestamp: number | null = null;
  private slots = new Map<number, boolean>();
  private ratio = 0;

  private config: typeof config;

  constructor(
    quest: MotionQuest,
    preparationAcknowledged: boolean,
    overrides: Partial<typeof config> = {},
  ) {
    this.config = { ...config, ...overrides };
    this.quest = quest;
    this.preparationAcknowledged = preparationAcknowledged;
  }

  update(observation: MotionObservation): DetectionProgress {
    const { timestamp, distance } = observation;
    if (
      !Number.isFinite(timestamp) ||
      (this.previousTimestamp !== null && timestamp <= this.previousTimestamp)
    )
      return this.progress("새로운 카메라 프레임을 기다리고 있어요.");
    if (this.stage === "detected") return this.progress("동작을 감지했어요.");
    const valid = observation.valid && distance !== null && Number.isFinite(distance);
    this.firstTimestamp ??= timestamp;
    const slot = Math.floor((timestamp - this.firstTimestamp) / this.config.qualitySlotMs);
    this.slots.set(slot, valid);
    const firstSlot = Math.max(0, slot - Math.ceil(3000 / this.config.qualitySlotMs) + 1);
    for (const key of this.slots.keys()) if (key < firstSlot) this.slots.delete(key);
    this.ratio = [...this.slots.values()].filter(Boolean).length / (slot - firstSlot + 1);
    const delta = this.previousTimestamp === null ? 0 : timestamp - this.previousTimestamp;
    let accumulated =
      this.previousValid && valid && delta <= this.config.maxAccumulationGapMs ? delta : 0;
    const gapLimit = this.quest === "water" ? this.config.waterMaxGapMs : this.config.maxGapMs;
    const lost = this.lastValidAt !== null && timestamp - this.lastValidAt > gapLimit;
    if (lost || observation.trackingChanged) {
      this.resetCandidate();
      accumulated = 0;
    }
    this.previousTimestamp = timestamp;
    this.previousValid = valid;
    if (!valid || distance === null) return this.progress(observation.reason);
    this.lastValidAt = timestamp;
    if (this.quest === "medicine" && !this.preparationAcknowledged)
      return this.progress("약 준비 확인을 먼저 선택해 주세요.");

    const far =
      distance >=
      (this.quest === "water" ? this.config.waterLeaveDistance : this.config.leaveDistance);
    const near =
      this.quest === "water"
        ? observation.objectAtMouth && distance <= this.config.waterEnterDistance
        : distance <= this.config.enterDistance;
    const holdTarget =
      this.quest === "water" ? this.config.waterHoldMs : this.config.medicineHoldMs;
    switch (this.stage) {
      case "ready":
        this.heldMs = far ? this.heldMs + accumulated : 0;
        if (this.heldMs >= this.config.stableMs) {
          this.stage = "approaching";
          this.heldMs = 0;
        }
        break;
      case "approaching":
        if (near) {
          this.stage = "at_mouth";
          this.heldMs = 0;
        }
        break;
      case "at_mouth":
        if (this.quest === "water" ? distance > this.config.waterHoldDistance : !near)
          this.resetCandidate();
        else {
          this.heldMs += accumulated;
          if (this.heldMs >= holdTarget) {
            this.stage = "returning";
            this.heldMs = 0;
          }
        }
        break;
      case "returning":
        this.heldMs = far ? this.heldMs + accumulated : 0;
        if (
          this.heldMs >= this.config.stableMs &&
          this.ratio >= this.config.minimumValidRatio &&
          (this.quest !== "water" || observation.objectEvidence === "detected")
        )
          this.stage = "detected";
        break;
    }
    const messages: Record<MotionStage, string> = {
      ready:
        this.quest === "water"
          ? "얼굴과 컵을 담고, 컵을 입 아래에 잠깐 보여 주세요."
          : "손을 입에서 떨어뜨린 상태로 잠깐 기다려 주세요.",
      approaching:
        this.quest === "water"
          ? "컵이나 병을 입으로 가져가 주세요."
          : "준비한 손을 입으로 가져가 주세요.",
      at_mouth: "입 근처에서 잠깐 유지해 주세요.",
      at_site: "지정 부위 근처의 손 움직임을 관찰하고 있어요.",
      returning:
        this.quest === "water"
          ? "컵을 화면 안에서 입 아래로 살짝 내려 주세요."
          : "손을 입에서 멀리 내려 주세요.",
      detected:
        this.quest === "water"
          ? "마시는 동작을 감지했어요."
          : "손을 입으로 가져가는 동작을 감지했어요.",
    };
    return this.progress(
      this.stage !== "detected" && observation.objectOccluded
        ? `${messages[this.stage]} 컵이 잠깐 가려져 손의 움직임을 따라 연결 중이에요.`
        : messages[this.stage],
    );
  }

  private resetCandidate() {
    this.stage = "ready";
    this.heldMs = 0;
    this.previousValid = false;
  }

  private progress(message: string): DetectionProgress {
    const target =
      this.stage === "at_mouth"
        ? this.quest === "water"
          ? this.config.waterHoldMs
          : this.config.medicineHoldMs
        : this.config.stableMs;
    return {
      stage: this.stage,
      holdProgress: Math.min(1, this.heldMs / target),
      validObservationRatio: this.ratio,
      message,
    };
  }
}
