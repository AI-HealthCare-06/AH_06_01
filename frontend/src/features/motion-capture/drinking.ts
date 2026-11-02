import { motionConfig } from "./config";
import type { DetectionProgress, MotionObservation, MotionStage } from "./types";

export const drinkingConfig = {
  version: "drinking-motion-v2",
  prepareMs: 150,
  returnMs: 150,
  minContactMs: 180,
  maxContactMs: 12000,
  gapMs: 700,
  maxFrameGapMs: 350,
  tiltDegrees: 12,
  cupShapeChange: 0.22,
  cupLift: 0.09,
  palmTurnDegrees: 15,
  withdrawalGraceMs: 900,
};

/** Observable approach, vessel/hand tipping and withdrawal; never verifies swallowed liquid. */
export class DrinkingDetector {
  private stage: MotionStage = "ready";
  private last: number | null = null;
  private lastValid: number | null = null;
  private stable = 0;
  private contactAt = 0;
  private baseline: MotionObservation["drinkMotion"];
  private tiltVotes = 0;
  private tipped = false;
  private lastNearAt: number | null = null;
  private quality = new Map<number, boolean>();

  update(o: MotionObservation): DetectionProgress {
    const t = o.timestamp;
    if (!Number.isFinite(t) || (this.last !== null && t <= this.last))
      return this.progress("새로운 영상 프레임을 기다리고 있어요.");
    if (this.stage === "detected") return this.progress();
    const delta = this.last === null ? 0 : t - this.last;
    const sameFace = !!o.mouth && !!o.faceWidth && o.faceWidth >= 40 && !o.faceTrackingChanged;
    if (
      (o.trackingChanged && !(this.tipped && sameFace)) ||
      (this.lastValid !== null && t - this.lastValid > drinkingConfig.gapMs)
    )
      this.reset();
    this.last = t;
    const valid = o.valid && o.distance !== null && Number.isFinite(o.distance) && !!o.object;
    const handWithdrawal =
      this.tipped &&
      sameFace &&
      !!o.hand &&
      this.lastNearAt !== null &&
      t - this.lastNearAt <= drinkingConfig.withdrawalGraceMs &&
      ((o.hand.y - o.mouth!.y) * o.frameHeight) / o.faceWidth! >= 0.35 &&
      Math.hypot((o.hand.x - o.mouth!.x) * o.frameWidth, (o.hand.y - o.mouth!.y) * o.frameHeight) /
        o.faceWidth! >=
        motionConfig.waterLeaveDistance;
    this.quality.set(Math.floor(t / 100), valid || handWithdrawal);
    for (const k of this.quality.keys())
      if (k < Math.floor((t - 1500) / 100)) this.quality.delete(k);
    if (!valid && !handWithdrawal) return this.progress(o.reason);
    this.lastValid = t;
    const dt = delta <= drinkingConfig.maxFrameGapMs ? delta : 0;
    const far = o.distance! >= motionConfig.waterLeaveDistance;
    const near = valid && o.distance! <= motionConfig.waterHoldDistance;
    if (near) this.lastNearAt = t;
    if (
      (this.stage === "at_mouth" || this.stage === "returning") &&
      t - this.contactAt > drinkingConfig.maxContactMs
    ) {
      this.reset();
      return this.progress("컵을 내린 뒤 자연스럽게 마시는 동작을 다시 보여 주세요.");
    }
    switch (this.stage) {
      case "ready":
        this.stable = far ? this.stable + dt : 0;
        if (this.stable >= drinkingConfig.prepareMs) {
          this.stage = "approaching";
          this.stable = 0;
        }
        break;
      case "approaching":
        if (near) {
          this.stage = "at_mouth";
          this.contactAt = t;
          this.baseline = o.drinkMotion;
          this.tiltVotes = 0;
          this.tipped = false;
        }
        break;
      case "at_mouth": {
        const pose = o.drinkMotion,
          base = this.baseline;
        const handTilt =
          pose?.handInclination !== null &&
          pose?.handInclination !== undefined &&
          base?.handInclination !== null &&
          base?.handInclination !== undefined &&
          Number.isFinite(pose.handInclination) &&
          Number.isFinite(base.handInclination) &&
          Math.abs(pose.handInclination - base.handInclination) >= drinkingConfig.tiltDegrees;
        const shapeTilt =
          !!pose &&
          !!base &&
          pose.shapeReliable !== false &&
          base.shapeReliable !== false &&
          o.objectEvidence === "detected" &&
          Number.isFinite(pose.aspect) &&
          Number.isFinite(base.aspect) &&
          pose.aspect > 0 &&
          base.aspect > 0 &&
          Math.abs(Math.log(pose.aspect / base.aspect)) >= drinkingConfig.cupShapeChange &&
          pose.lift - base.lift >= drinkingConfig.cupLift;
        const normal = pose?.palmNormal,
          initialNormal = base?.palmNormal;
        const palmTurn =
          !!normal &&
          !!initialNormal &&
          (Math.acos(
            Math.max(
              0,
              Math.min(
                1,
                Math.abs(
                  normal.x * initialNormal.x +
                    normal.y * initialNormal.y +
                    normal.z * initialNormal.z,
                ),
              ),
            ),
          ) *
            180) /
            Math.PI >=
            drinkingConfig.palmTurnDegrees &&
          pose!.lift - base!.lift >= drinkingConfig.cupLift;
        if (delta > drinkingConfig.maxFrameGapMs) this.tiltVotes = 0;
        else if (
          o.distance! <= motionConfig.waterHoldDistance &&
          (handTilt || shapeTilt || palmTurn)
        )
          this.tiltVotes++;
        else if (
          !this.tipped &&
          ((pose?.handInclination !== null &&
            pose?.handInclination !== undefined &&
            base?.handInclination !== null &&
            base?.handInclination !== undefined) ||
            o.objectEvidence === "detected")
        )
          this.tiltVotes = 0;
        if (this.tiltVotes >= 2 && t - this.contactAt >= drinkingConfig.minContactMs) {
          this.tipped = true;
          this.stage = "returning";
          this.stable = 0;
        }
        if (far) {
          if (this.tipped) {
            this.stage = "returning";
            this.stable = dt;
          } else this.reset();
        }
        break;
      }
      case "returning":
        this.stable = (far && valid) || handWithdrawal ? this.stable + dt : 0;
        if (
          this.stable >= drinkingConfig.returnMs &&
          (o.objectEvidence === "detected" || handWithdrawal) &&
          this.ratio() >= 0.55
        )
          this.stage = "detected";
        break;
    }
    return this.progress();
  }
  private ratio() {
    const v = [...this.quality.values()];
    return v.length ? v.filter(Boolean).length / v.length : 0;
  }
  private reset() {
    this.stage = "ready";
    this.stable = 0;
    this.tiltVotes = 0;
    this.tipped = false;
    this.baseline = undefined;
    this.lastNearAt = null;
  }
  private progress(reason?: string): DetectionProgress {
    const messages: Record<MotionStage, string> = {
      ready: "컵을 입 아래에 잠깐 보여 주세요.",
      approaching: "자연스럽게 컵을 입으로 가져가 마시는 동작을 보여 주세요.",
      at_mouth: "컵·손의 기울어지는 움직임을 확인해요. 오래 멈출 필요는 없어요.",
      returning: "마신 뒤 컵을 내려 주세요.",
      at_site: "동작을 관찰하고 있어요.",
      detected: "컵 접근·기울임·내림 동작을 감지했어요.",
    };
    return {
      stage: this.stage,
      holdProgress:
        this.stage === "detected"
          ? 1
          : this.stage === "at_mouth"
            ? Math.min(1, this.tiltVotes / 2)
            : this.stage === "returning"
              ? Math.min(1, this.stable / drinkingConfig.returnMs)
              : 0,
      validObservationRatio: this.ratio(),
      message: reason || messages[this.stage],
    };
  }
}
