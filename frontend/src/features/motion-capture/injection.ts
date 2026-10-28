import type { DetectionProgress, Point, ProcessTrace } from "./types";

export type InjectionRegion = Point & { radius: number };
export type InjectionObservation = {
  timestamp: number;
  frameWidth: number;
  frameHeight: number;
  hands: Point[];
};
export const injectionConfig = {
  version: "injection-site-hand-v1.0",
  stableMs: 400,
  holdMs: 1200,
  maxFrameGapMs: 350,
  maxLostMs: 800,
  maxHandJump: 0.35,
};

/** Only recognizes a hand entering/leaving a user-marked site; no tool/needle detection. */
export class InjectionDetector {
  private region: InjectionRegion;
  private stage: DetectionProgress["stage"] = "ready";
  private previous: { timestamp: number; point: Point } | null = null;
  private timestamp: number | null = null;
  private heldMs = 0;
  private trace: ProcessTrace[] = [];
  private samples = new Map<number, boolean>();
  private firstTimestamp: number | null = null;
  constructor(region: InjectionRegion) {
    this.region = region;
  }
  update(frame: InjectionObservation): DetectionProgress {
    const time = frame.timestamp;
    if (!Number.isFinite(time) || (this.timestamp !== null && time <= this.timestamp))
      return this.progress("새 영상 프레임을 기다리고 있어요.");
    const gap = this.timestamp === null ? 0 : time - this.timestamp;
    this.timestamp = time;
    if (this.stage === "detected")
      return this.progress("지정 부위에 손이 접근했다 떨어지는 동작을 감지했어요.");
    const validFrame = frame.frameWidth > 0 && frame.frameHeight > 0;
    const distance = (a: Point, b: Point) =>
      Math.hypot((a.x - b.x) * frame.frameWidth, (a.y - b.y) * frame.frameHeight) /
      Math.min(frame.frameWidth, frame.frameHeight);
    const hands = validFrame
      ? frame.hands.filter(
          (p) =>
            Number.isFinite(p.x) &&
            Number.isFinite(p.y) &&
            p.x >= 0 &&
            p.x <= 1 &&
            p.y >= 0 &&
            p.y <= 1,
        )
      : [];
    const target = this.previous?.point ?? this.region;
    const hand = hands.reduce<Point | null>(
      (best, p) => (!best || distance(p, target) < distance(best, target) ? p : best),
      null,
    );
    const switched =
      hand && this.previous && distance(hand, this.previous.point) > injectionConfig.maxHandJump;
    const lost = this.previous && time - this.previous.timestamp > injectionConfig.maxLostMs;
    if (switched || lost || gap > injectionConfig.maxLostMs) this.reset(time);
    this.firstTimestamp ??= time;
    const slot = Math.floor((time - this.firstTimestamp) / 200);
    this.samples.set(slot, hand !== null);
    for (const key of this.samples.keys()) if (key < slot - 14) this.samples.delete(key);
    const delta =
      hand &&
      this.previous &&
      gap <= injectionConfig.maxFrameGapMs &&
      this.previous.timestamp === time - gap &&
      !switched
        ? gap
        : 0;
    if (!hand) return this.progress("지정한 부위와 도구를 잡은 손이 함께 보이게 해 주세요.");
    this.previous = { timestamp: time, point: hand };
    const near = distance(hand, this.region) <= this.region.radius;
    const far = distance(hand, this.region) >= this.region.radius * 1.6;
    const prior = this.stage;
    switch (this.stage) {
      case "ready":
        this.heldMs = far ? this.heldMs + delta : 0;
        if (this.heldMs >= injectionConfig.stableMs) {
          this.stage = "approaching";
          this.heldMs = 0;
        }
        break;
      case "approaching":
        if (near) {
          this.stage = "at_site";
          this.heldMs = 0;
        }
        break;
      case "at_site":
        if (!near) {
          this.stage = "ready";
          this.heldMs = 0;
        } else {
          this.heldMs += delta;
          if (this.heldMs >= injectionConfig.holdMs) {
            this.stage = "returning";
            this.heldMs = 0;
          }
        }
        break;
      case "returning":
        this.heldMs = far ? this.heldMs + delta : 0;
        if (this.heldMs >= injectionConfig.stableMs && this.ratio() >= 0.8) this.stage = "detected";
        break;
    }
    if (this.stage !== prior) this.trace.push({ event: `site:${this.stage}`, timestamp: time });
    const messages = {
      ready: "먼저 지정 부위에서 떨어진 손을 화면에 보여 주세요.",
      approaching: "지정 부위로 손이 접근하는 동작을 관찰하고 있어요.",
      at_site: "지정 부위 근처의 손 움직임을 관찰하고 있어요.",
      returning: "손이 지정 부위에서 떨어지는 동작을 기다리고 있어요.",
      detected: "지정 부위에 손이 접근했다 떨어지는 동작을 감지했어요.",
      at_mouth: "지정 부위 근처의 손 움직임을 관찰하고 있어요.",
    };
    return this.progress(messages[this.stage]);
  }
  private reset(time: number) {
    this.stage = "ready";
    this.heldMs = 0;
    this.previous = null;
    this.trace.push({ event: "site:reset", timestamp: time });
  }
  private ratio() {
    const keys = [...this.samples.keys()];
    return keys.length
      ? [...this.samples.values()].filter(Boolean).length /
          (Math.max(...keys) - Math.min(...keys) + 1)
      : 0;
  }
  private progress(message: string): DetectionProgress {
    this.trace = this.trace.slice(-40);
    return {
      stage: this.stage,
      holdProgress: Math.min(
        1,
        this.heldMs /
          (this.stage === "at_site" ? injectionConfig.holdMs : injectionConfig.stableMs),
      ),
      validObservationRatio: this.ratio(),
      message,
      process: {
        phase: this.stage === "detected" ? "complete" : "injection",
        completedSteps: this.stage === "detected" ? ["site_hand"] : [],
        trace: [...this.trace],
      },
    };
  }
}

/** Map a mirrored object-fit:contain preview click into original frame coordinates. */
export function injectionPoint(
  x: number,
  y: number,
  box: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): InjectionRegion | null {
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(box.width / width, box.height / height);
  const left = box.left + (box.width - width * scale) / 2,
    top = box.top + (box.height - height * scale) / 2;
  const px = (x - left) / (width * scale),
    py = (y - top) / (height * scale);
  if (px < 0 || px > 1 || py < 0 || py > 1) return null;
  return { x: 1 - px, y: py, radius: 0.12 };
}

export function sampleInjection(elapsed: number, timestamp: number): InjectionObservation {
  const x =
    elapsed < 1000
      ? 0.18
      : elapsed < 2000
        ? 0.18 + ((elapsed - 1000) / 1000) * 0.32
        : elapsed < 4200
          ? 0.5
          : elapsed < 5200
            ? 0.5 - ((elapsed - 4200) / 1000) * 0.32
            : 0.18;
  return { timestamp, frameWidth: 360, frameHeight: 480, hands: [{ x, y: 0.6 }] };
}
