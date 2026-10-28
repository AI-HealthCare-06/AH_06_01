import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  ObjectDetector,
} from "@mediapipe/tasks-vision";
import type { Detection } from "@mediapipe/tasks-vision";
import { motionConfig } from "./config";
import { extractInjectionHands, extractObservation } from "./features";
import type { MotionObservation, MotionQuest, WorkerRequest, WorkerResponse } from "./types";

let sessionId = "";
let quest: MotionQuest = "water";
let processMode = false;
let injectionMode = false;
let previousDrink: MotionObservation | null = null;
let face: FaceLandmarker | null = null;
let hand: HandLandmarker | null = null;
let object: ObjectDetector | null = null;
let detections: Detection[] = [];
let objectAt = -Infinity;
let previous: MotionObservation | null = null;
const send = (message: WorkerResponse) => self.postMessage(message);

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === "init") {
    sessionId = data.sessionId;
    quest = data.quest;
    processMode = data.process === true;
    injectionMode = data.injection === true;
    previousDrink = null;
    try {
      const base = data.baseUrl;
      const files = await FilesetResolver.forVisionTasks(`${base}/vendor/mediapipe/wasm`, true);
      // Each task consumes ModuleFactory. Module workers cache imports, so use
      // a distinct loader URL per task to execute the factory initializer again.
      const filesFor = (task: string) => ({
        ...files,
        wasmLoaderPath: `${files.wasmLoaderPath}?task=${task}`,
      });
      if (!injectionMode)
        send({ type: "loading", sessionId, message: "얼굴 추적 모델을 준비하고 있어요…" });
      if (!injectionMode)
        face = await FaceLandmarker.createFromOptions(filesFor("face"), {
          baseOptions: {
            modelAssetPath: `${base}/models/motion-capture/face_landmarker.task`,
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numFaces: 2,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
          canvas: new OffscreenCanvas(1, 1),
        });
      send({ type: "loading", sessionId, message: "손 추적 모델을 준비하고 있어요…" });
      hand = await HandLandmarker.createFromOptions(filesFor("hand"), {
        baseOptions: {
          modelAssetPath: `${base}/models/motion-capture/hand_landmarker.task`,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        canvas: new OffscreenCanvas(1, 1),
      });
      if (quest === "water" || processMode) {
        send({ type: "loading", sessionId, message: "컵과 병 탐지 모델을 준비하고 있어요…" });
        object = await ObjectDetector.createFromOptions(filesFor("object"), {
          baseOptions: {
            modelAssetPath: `${base}/models/motion-capture/efficientdet_lite0.tflite`,
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          scoreThreshold: motionConfig.objectContinueScore,
          categoryAllowlist: ["cup", "bottle"],
          maxResults: 5,
          canvas: new OffscreenCanvas(1, 1),
        });
      }
      send({ type: "ready", sessionId });
    } catch (error) {
      console.error("Motion model initialization failed", error);
      face?.close();
      hand?.close();
      object?.close();
      send({
        type: "error",
        sessionId,
        message: "인식 모델을 준비하지 못했어요. 다시 시도하거나 샘플 동작을 확인해 주세요.",
      });
    }
    return;
  }
  try {
    if (data.sessionId !== sessionId || (!injectionMode && !face) || !hand) return;
    const started = performance.now();
    const { image, timestamp } = data;
    const resized =
      previous !== null &&
      (previous.frameWidth !== image.width || previous.frameHeight !== image.height);
    if (resized) {
      detections = [];
      objectAt = -Infinity;
      previous = null;
      previousDrink = null;
    }
    const faceResult = face?.detectForVideo(image, timestamp) ?? {
      faceLandmarks: [],
      faceBlendshapes: [],
      facialTransformationMatrixes: [],
    };
    const handResult = hand.detectForVideo(image, timestamp);
    if (object && timestamp - objectAt >= motionConfig.objectIntervalMs) {
      detections = object.detectForVideo(image, timestamp).detections;
      objectAt = timestamp;
    }
    const observation = extractObservation(
      quest,
      faceResult,
      handResult,
      timestamp - objectAt <= motionConfig.objectMaxAgeMs ? detections : [],
      timestamp,
      image.width,
      image.height,
      previous,
      objectAt,
    );
    let process;
    if (processMode) {
      const handObservation =
        quest === "medicine"
          ? observation
          : extractObservation(
              "medicine",
              faceResult,
              handResult,
              [],
              timestamp,
              image.width,
              image.height,
              null,
            );
      const drinkObservation =
        quest === "water"
          ? observation
          : extractObservation(
              "water",
              faceResult,
              handResult,
              timestamp - objectAt <= motionConfig.objectMaxAgeMs ? detections : [],
              timestamp,
              image.width,
              image.height,
              previousDrink,
              objectAt,
            );
      if (drinkObservation.valid) previousDrink = drinkObservation;
      else if (
        drinkObservation.trackingChanged ||
        (previousDrink && timestamp - previousDrink.timestamp > motionConfig.waterMaxGapMs)
      )
        previousDrink = null;
      if (resized) {
        handObservation.faceTrackingChanged = true;
        drinkObservation.faceTrackingChanged = true;
      }
      process = { hand: handObservation, drink: drinkObservation };
    }
    if (resized) observation.trackingChanged = true;
    if (quest !== "water" || observation.valid) previous = observation;
    else if (
      observation.trackingChanged ||
      (previous && timestamp - previous.timestamp > motionConfig.waterMaxGapMs)
    )
      previous = null;
    send({
      type: "observation",
      sessionId,
      observation,
      ...(process ? { process } : {}),
      ...(injectionMode
        ? { injection: extractInjectionHands(handResult, timestamp, image.width, image.height) }
        : {}),
      latencyMs: performance.now() - started,
    });
  } catch (error) {
    console.error("Motion inference failed", error);
    send({
      type: "error",
      sessionId,
      message: "이 기기에서 인식을 계속할 수 없어요. 촬영을 종료했어요.",
    });
  } finally {
    data.image.close();
  }
};
