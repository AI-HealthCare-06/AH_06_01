import { motionConfig as config } from "./config";
import { DrinkingDetector } from "./drinking";
import type { DetectionProgress, MotionObservation, MotionQuest, MotionStage } from "./types";

/** Routes drinking to its dynamic sequence; medication's first phase is hand-to-mouth only. */
export class MotionDetector {
  private drinking: DrinkingDetector | null;
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
    this.drinking = quest === "water" ? new DrinkingDetector() : null;
    this.preparationAcknowledged = preparationAcknowledged;
  }
  update(o: MotionObservation): DetectionProgress {
    if (this.drinking) return this.drinking.update(o);
    const { timestamp, distance } = o;
    if (
      !Number.isFinite(timestamp) ||
      (this.previousTimestamp !== null && timestamp <= this.previousTimestamp)
    )
      return this.progress("새로운 카메라 프레임을 기다리고 있어요.");
    if (this.stage === "detected") return this.progress("손을 입으로 가져가는 동작을 감지했어요.");
    const valid = o.valid && distance !== null && Number.isFinite(distance);
    this.firstTimestamp ??= timestamp;
    const slot = Math.floor((timestamp - this.firstTimestamp) / this.config.qualitySlotMs);
    this.slots.set(slot, valid);
    const firstSlot = Math.max(0, slot - Math.ceil(3000 / this.config.qualitySlotMs) + 1);
    for (const key of this.slots.keys()) if (key < firstSlot) this.slots.delete(key);
    this.ratio = [...this.slots.values()].filter(Boolean).length / (slot - firstSlot + 1);
    const delta = this.previousTimestamp === null ? 0 : timestamp - this.previousTimestamp;
    let accumulated =
      this.previousValid && valid && delta <= this.config.maxAccumulationGapMs ? delta : 0;
    if (
      (this.lastValidAt !== null && timestamp - this.lastValidAt > this.config.maxGapMs) ||
      o.trackingChanged
    ) {
      this.resetCandidate();
      accumulated = 0;
    }
    this.previousTimestamp = timestamp;
    this.previousValid = valid;
    if (!valid || distance === null) return this.progress(o.reason);
    this.lastValidAt = timestamp;
    if (!this.preparationAcknowledged) return this.progress("약 준비 확인을 먼저 선택해 주세요.");
    const far = distance >= this.config.leaveDistance,
      near = distance <= this.config.enterDistance;
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
        if (!near) this.resetCandidate();
        else {
          this.heldMs += accumulated;
          if (this.heldMs >= this.config.medicineHoldMs) {
            this.stage = "returning";
            this.heldMs = 0;
          }
        }
        break;
      case "returning":
        this.heldMs = far ? this.heldMs + accumulated : 0;
        if (this.heldMs >= this.config.stableMs && this.ratio >= this.config.minimumValidRatio)
          this.stage = "detected";
        break;
    }
    const messages: Record<MotionStage, string> = {
      ready: "손을 입에서 떨어뜨린 상태로 잠깐 기다려 주세요.",
      approaching: "준비한 손을 입으로 가져가 주세요.",
      at_mouth: "약을 준비한 손의 동작을 확인해요.",
      at_site: "지정 부위의 손 움직임을 관찰해요.",
      returning: "손을 입에서 멀리 내려 주세요.",
      detected: "손을 입으로 가져가는 동작을 감지했어요.",
    };
    return this.progress(messages[this.stage]);
  }
  private resetCandidate() {
    this.stage = "ready";
    this.heldMs = 0;
    this.previousValid = false;
  }
  private progress(message: string): DetectionProgress {
    const target = this.stage === "at_mouth" ? this.config.medicineHoldMs : this.config.stableMs;
    return {
      stage: this.stage,
      holdProgress: Math.min(1, this.heldMs / target),
      validObservationRatio: this.ratio,
      message,
    };
  }
}
