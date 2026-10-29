import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { z } from "zod";
import type {
  Detection,
  FaceLandmarkerResult,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { extractObservation, extractInjectionHands } from "./features";
import type { MotionObservation, MotionQuest, ProcessObservation } from "./types";
import type { InjectionObservation, InjectionRegion } from "./injection";
import { toolEvidence } from "./tools";

const point = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite().optional(),
});
export const nativeFrameSchema = z.object({
  sessionId: z.string().max(100),
  timestamp: z.number().finite().nonnegative(),
  frameWidth: z.number().int().min(1).max(8192),
  frameHeight: z.number().int().min(1).max(8192),
  faces: z
    .array(
      z
        .array(
          point.extend({
            index: z.union([z.literal(13), z.literal(14), z.literal(234), z.literal(454)]),
          }),
        )
        .length(4),
    )
    .max(2),
  hands: z.array(z.array(point).length(21)).max(2),
  detections: z
    .array(
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative(),
        categories: z
          .array(
            z.object({
              categoryName: z.string().max(100),
              score: z.number().finite().min(0).max(1),
            }),
          )
          .max(8),
      }),
    )
    .max(5),
  objectObservedAt: z.number().finite(),
  latencyMs: z.number().finite().min(0).max(60000),
  frames: z.number().int().nonnegative(),
  throttledFrames: z.number().int().nonnegative(),
  p50Ms: z.number().finite().nonnegative(),
  p95Ms: z.number().finite().nonnegative(),
  delegate: z.string().max(160),
  toolModelReady: z.boolean().optional().default(false),
  toolObservedAt: z.number().finite().optional().default(0),
  toolDetections: z
    .array(
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().nonnegative(),
        height: z.number().nonnegative(),
        categories: z
          .array(z.object({ categoryName: z.string().max(100), score: z.number().min(0).max(1) }))
          .max(3),
      }),
    )
    .max(5)
    .optional()
    .default([]),
});
export type RuntimeStats = {
  backend: "android-native" | "web-worker";
  delegate: string;
  frames: number;
  p50Ms: number;
  p95Ms: number;
  throttledFrames: number;
};
type NativeFrame = z.infer<typeof nativeFrameSchema>;
interface NativePlugin {
  start(options: {
    sessionId: string;
    injection: boolean;
    quest: MotionQuest;
    delegate: "auto" | "cpu";
    recordFeatures: boolean;
  }): Promise<{ backend: string; delegate: string }>;
  stop(options: { sessionId: string }): Promise<void>;
  setProgress(options: {
    sessionId: string;
    message: string;
    holdProgress: number;
    region?: InjectionRegion;
  }): Promise<void>;
  addListener(event: string, callback: (event: unknown) => void): Promise<PluginListenerHandle>;
}
const plugin = registerPlugin<NativePlugin>("MotionVision");
export const nativeMotionAvailable = () =>
  Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("MotionVision");

/** Align native monotonic timestamps once; keep sparse landmarks off the bridge. */
export class NativeObservationAdapter {
  private offset: number | null = null;
  private previous: MotionObservation | null = null;
  private previousDrink: MotionObservation | null = null;
  private last = -Infinity;
  private quest: MotionQuest;
  constructor(quest: MotionQuest) {
    this.quest = quest;
  }
  update(frame: NativeFrame, receivedAt = performance.now()) {
    if (frame.timestamp <= this.last) return null;
    this.last = frame.timestamp;
    this.offset ??= receivedAt - frame.latencyMs - frame.timestamp;
    const timestamp = frame.timestamp + this.offset;
    const resized =
      this.previous &&
      (this.previous.frameWidth !== frame.frameWidth ||
        this.previous.frameHeight !== frame.frameHeight);
    if (resized) {
      this.previous = null;
      this.previousDrink = null;
    }
    const face = {
      faceLandmarks: frame.faces.map((sparse) => {
        const points = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
        for (const p of sparse) points[p.index] = { x: p.x, y: p.y, z: p.z ?? 0, visibility: 1 };
        return points;
      }),
      faceBlendshapes: [],
      facialTransformationMatrixes: [],
    } as FaceLandmarkerResult;
    const hands = {
      landmarks: frame.hands.map((hand) => hand.map((p) => ({ ...p, z: p.z ?? 0, visibility: 1 }))),
      worldLandmarks: [],
      handedness: [],
      handednesses: [],
    } as HandLandmarkerResult;
    const detections = frame.detections.map((d) => ({
      boundingBox: { originX: d.x, originY: d.y, width: d.width, height: d.height, angle: 0 },
      categories: d.categories.map((c) => ({ ...c, index: 0, displayName: "" })),
      keypoints: [],
    })) as Detection[];
    const at = frame.objectObservedAt + this.offset;
    const observation = extractObservation(
      this.quest,
      face,
      hands,
      detections,
      timestamp,
      frame.frameWidth,
      frame.frameHeight,
      this.previous,
      at,
    );
    const hand =
      this.quest === "medicine"
        ? observation
        : extractObservation(
            "medicine",
            face,
            hands,
            [],
            timestamp,
            frame.frameWidth,
            frame.frameHeight,
            null,
          );
    const drink =
      this.quest === "water"
        ? observation
        : extractObservation(
            "water",
            face,
            hands,
            detections,
            timestamp,
            frame.frameWidth,
            frame.frameHeight,
            this.previousDrink,
            at,
          );
    if (resized) {
      observation.trackingChanged = true;
      hand.faceTrackingChanged = true;
      drink.faceTrackingChanged = true;
    }
    this.previous = observation.valid ? observation : null;
    this.previousDrink = drink.valid ? drink : null;
    return {
      observation,
      process: {
        hand,
        drink,
        tools: toolEvidence(
          frame.toolDetections.map((d) => ({
            boundingBox: { originX: d.x, originY: d.y, width: d.width, height: d.height, angle: 0 },
            categories: d.categories.map((c) => ({ ...c, index: 0, displayName: "" })),
            keypoints: [],
          })),
          frame.toolObservedAt + this.offset,
          frame.frameWidth,
          frame.frameHeight,
          frame.toolModelReady,
        ),
      },
      injection: extractInjectionHands(hands, timestamp, frame.frameWidth, frame.frameHeight),
    };
  }
}

export function createNativeSession(options: {
  sessionId: string;
  quest: MotionQuest;
  injection: boolean;
  recordFeatures?: boolean;
  onFinish?: () => void;
  onFrame: (
    observation: MotionObservation,
    latency: number,
    process: ProcessObservation,
    injection: InjectionObservation,
    stats: RuntimeStats,
  ) => void;
  onTap: (region: InjectionRegion) => void;
  onStop: () => void;
  onError: (message: string) => void;
}) {
  const adapter = new NativeObservationAdapter(options.quest);
  const listeners: PluginListenerHandle[] = [];
  let stopped = false;
  let lastProgress = "";
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const listener of listeners.splice(0)) void listener.remove();
    void plugin.stop({ sessionId: options.sessionId }).catch(() => {});
  };
  return {
    stop,
    async start() {
      for (const [name, callback] of [
        [
          "motionFrame",
          (raw: unknown) => {
            if (
              !raw ||
              typeof raw !== "object" ||
              (raw as { sessionId?: string }).sessionId !== options.sessionId ||
              stopped
            )
              return;
            const parsed = nativeFrameSchema.safeParse(raw);
            if (!parsed.success) {
              options.onError("카메라 인식 결과 형식을 확인하지 못했어요.");
              return;
            }
            const frame = parsed.data;
            if (stopped || frame.sessionId !== options.sessionId) return;
            const converted = adapter.update(frame);
            if (converted)
              options.onFrame(
                converted.observation,
                frame.latencyMs,
                converted.process,
                converted.injection,
                {
                  backend: "android-native",
                  delegate: frame.delegate,
                  frames: frame.frames,
                  p50Ms: frame.p50Ms,
                  p95Ms: frame.p95Ms,
                  throttledFrames: frame.throttledFrames,
                },
              );
          },
        ],
        [
          "motionTap",
          (raw: unknown) => {
            const value = z
              .object({
                sessionId: z.string(),
                x: z.number().min(0).max(1),
                y: z.number().min(0).max(1),
              })
              .safeParse(raw);
            if (!stopped && value.success && value.data.sessionId === options.sessionId)
              options.onTap({ x: value.data.x, y: value.data.y, radius: 0.12 });
          },
        ],
        [
          "motionFinish",
          (raw: unknown) => {
            if (!stopped && (raw as { sessionId?: string }).sessionId === options.sessionId)
              (options.onFinish ?? options.onStop)();
          },
        ],
        [
          "motionStopped",
          (raw: unknown) => {
            if (!stopped && (raw as { sessionId?: string }).sessionId === options.sessionId)
              options.onStop();
          },
        ],
        [
          "motionError",
          (raw: unknown) => {
            if (!stopped && (raw as { sessionId?: string }).sessionId === options.sessionId)
              options.onError("네이티브 인식을 계속할 수 없어요. 다시 시작해 주세요.");
          },
        ],
      ] as const) {
        const listener = await plugin.addListener(name, callback);
        if (stopped) {
          await listener.remove();
          throw new Error("Session closed");
        }
        listeners.push(listener);
      }
      const ready = await plugin.start({
        sessionId: options.sessionId,
        quest: options.quest,
        injection: options.injection,
        delegate: "auto",
        recordFeatures: options.recordFeatures === true,
      });
      if (stopped) {
        await plugin.stop({ sessionId: options.sessionId });
        throw new Error("Session closed");
      }
      return ready;
    },
    progress(message: string, holdProgress: number, region: InjectionRegion | null) {
      const signature = `${message}:${Math.round(holdProgress * 10)}:${JSON.stringify(region)}`;
      if (stopped || signature === lastProgress) return;
      lastProgress = signature;
      void plugin
        .setProgress({
          sessionId: options.sessionId,
          message,
          holdProgress,
          ...(region ? { region } : {}),
        })
        .catch(() => {});
    },
  };
}
