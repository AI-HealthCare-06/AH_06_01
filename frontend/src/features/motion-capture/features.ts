import type {
  Detection,
  FaceLandmarkerResult,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { motionConfig as config } from "./config";
import type { MotionObservation, MotionQuest, ObjectBox, Point } from "./types";

import type { InjectionObservation } from "./injection";

export function extractInjectionHands(
  hands: HandLandmarkerResult,
  timestamp: number,
  frameWidth: number,
  frameHeight: number,
): InjectionObservation {
  return {
    timestamp,
    frameWidth,
    frameHeight,
    hands: hands.landmarks.flatMap((points) => {
      const palm = [0, 5, 9, 13, 17].map((index) => points[index]).filter(visible);
      return palm.length >= 3
        ? [
            {
              x: palm.reduce((s, p) => s + p.x, 0) / palm.length,
              y: palm.reduce((s, p) => s + p.y, 0) / palm.length,
            },
          ]
        : [];
    }),
  };
}

const length = (a: Point, b: Point, width: number, height: number) =>
  Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const visible = (p: Point) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const distanceToBox = (p: Point, box: ObjectBox, width: number, height: number) =>
  Math.hypot(
    Math.max(box.x - p.x, 0, p.x - box.x - box.width) * width,
    Math.max(box.y - p.y, 0, p.y - box.y - box.height) * height,
  );
const center = (box: ObjectBox): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});
const sameObject = (
  box: ObjectBox,
  expected: ObjectBox,
  width: number,
  height: number,
  faceWidth: number,
) =>
  box.label === expected.label &&
  length(center(box), center(expected), width, height) / faceWidth <= 0.6 &&
  box.width / expected.width >= 0.4 &&
  box.width / expected.width <= 2.5 &&
  box.height / expected.height >= 0.4 &&
  box.height / expected.height <= 2.5;

export function extractObservation(
  quest: MotionQuest,
  face: FaceLandmarkerResult,
  hands: HandLandmarkerResult,
  detections: Detection[],
  timestamp: number,
  width: number,
  height: number,
  previous: MotionObservation | null,
  objectTimestamp = timestamp,
): MotionObservation {
  const observation: MotionObservation = {
    frameWidth: width,
    frameHeight: height,
    timestamp,
    valid: false,
    reason: "얼굴과 손을 화면에 함께 담아 주세요.",
    distance: null,
    objectAtMouth: false,
    trackingChanged: false,
    mouth: null,
    faceWidth: null,
    hand: null,
    object: null,
    objectEvidence: null,
    objectObservedAt: null,
    objectOccluded: false,
  };
  if (face.faceLandmarks.length !== 1) {
    observation.reason =
      face.faceLandmarks.length > 1
        ? "한 사람만 화면에 담아 주세요."
        : "얼굴을 화면 중앙에 담아 주세요.";
    observation.trackingChanged = face.faceLandmarks.length > 1;
    observation.faceTrackingChanged = face.faceLandmarks.length > 1;
    return observation;
  }
  const landmarks = face.faceLandmarks[0];
  const mouth = midpoint(landmarks[13], landmarks[14]);
  const faceWidth = length(landmarks[234], landmarks[454], width, height);
  observation.mouth = mouth;
  observation.faceWidth = faceWidth;
  if (!visible(mouth) || !Number.isFinite(faceWidth) || faceWidth < 40) {
    observation.reason = "입과 양쪽 볼이 화면 안에 보이도록 담아 주세요.";
    return observation;
  }
  const candidates = hands.landmarks
    .flatMap((hand) => {
      if (quest === "medicine") return [midpoint(hand[4], hand[8])];
      const palm = [0, 5, 9, 13, 17].map((index) => hand[index]).filter(visible);
      // A cropped wrist is common in a handheld selfie; use the visible palm.
      return palm.length >= 2
        ? [
            {
              x: palm.reduce((sum, point) => sum + point.x, 0) / palm.length,
              y: palm.reduce((sum, point) => sum + point.y, 0) / palm.length,
            },
          ]
        : [];
    })
    .filter(visible);
  if (quest === "medicine" && !candidates.length) return observation;
  const boxes = detections.flatMap((detection) => {
    const box = detection.boundingBox;
    const label = detection.categories[0]?.categoryName;
    const score = detection.categories[0]?.score;
    if (
      !box ||
      !["cup", "bottle"].includes(label) ||
      !Number.isFinite(score) ||
      score < config.objectContinueScore ||
      ![box.originX, box.originY, box.width, box.height].every(Number.isFinite) ||
      box.width <= 0 ||
      box.height <= 0
    )
      return [];
    // Accept a visible part of a close-up cup; never use edges outside the preview.
    const left = Math.max(0, box.originX),
      top = Math.max(0, box.originY);
    const right = Math.min(width, box.originX + box.width);
    const bottom = Math.min(height, box.originY + box.height);
    if (right <= left || bottom <= top) return [];
    return [
      {
        score,
        box: {
          x: left / width,
          y: top / height,
          width: (right - left) / width,
          height: (bottom - top) / height,
          label,
        },
      },
    ];
  });
  const faceScale = previous?.faceWidth ? faceWidth / previous.faceWidth : 1;
  const alignToFace = (point: Point): Point =>
    previous?.mouth
      ? {
          x: mouth.x + (point.x - previous.mouth.x) * faceScale,
          y: mouth.y + (point.y - previous.mouth.y) * faceScale,
        }
      : point;
  const previousHand = previous?.hand
    ? quest === "water"
      ? alignToFace(previous.hand)
      : previous.hand
    : null;
  const cost = (point: Point) =>
    previousHand
      ? length(point, previousHand, width, height)
      : quest === "water" && boxes.length
        ? Math.min(...boxes.map(({ box }) => distanceToBox(point, box, width, height)))
        : length(point, mouth, width, height);
  const hand = candidates.reduce<Point | null>(
    (best, point) => (!best || cost(point) < cost(best) ? point : best),
    null,
  );
  observation.hand = hand;
  if (quest === "medicine" && hand) {
    const chosen = hands.landmarks.find((points) => {
      const pinch = midpoint(points[4], points[8]);
      return length(pinch, hand, width, height) < 0.01;
    });
    if (chosen && [chosen[0], chosen[4], chosen[8], chosen[9]].every(visible)) {
      const palmLength = length(chosen[0], chosen[9], width, height);
      if (palmLength >= 12)
        observation.pinchRatio = length(chosen[4], chosen[8], width, height) / palmLength;
    }
  }
  observation.distance = hand ? length(hand, mouth, width, height) / faceWidth : null;
  if (hand && previousHand && length(hand, previousHand, width, height) / faceWidth > 1.5)
    observation.trackingChanged = true;
  if (
    previous?.mouth &&
    (length(mouth, previous.mouth, width, height) / faceWidth > (quest === "water" ? 2 : 0.7) ||
      (quest === "water" && (faceScale < 0.5 || faceScale > 2)))
  ) {
    observation.trackingChanged = true;
    observation.faceTrackingChanged = true;
  }
  if (quest === "water") {
    const anchor =
      previous?.valid && previous.object && previous.objectObservedAt !== null
        ? {
            ...previous,
            object: previous.object,
            objectObservedAt: previous.objectObservedAt,
          }
        : null;
    const continuous =
      anchor !== null &&
      !observation.trackingChanged &&
      timestamp >= anchor.timestamp &&
      timestamp - anchor.timestamp <= config.waterMaxGapMs &&
      timestamp - anchor.objectObservedAt <= config.objectOcclusionMs &&
      anchor.frameWidth === width &&
      anchor.frameHeight === height;
    const alignedObject = continuous
      ? {
          ...anchor.object,
          ...alignToFace(anchor.object),
          width: anchor.object.width * faceScale,
          height: anchor.object.height * faceScale,
        }
      : null;
    const expected =
      alignedObject && hand && previousHand
        ? {
            ...alignedObject,
            x: alignedObject.x + hand.x - previousHand.x,
            y: alignedObject.y + hand.y - previousHand.y,
          }
        : alignedObject;
    const fresh =
      objectTimestamp <= timestamp &&
      timestamp - objectTimestamp <= config.objectMaxAgeMs &&
      (anchor === null || objectTimestamp > anchor.objectObservedAt);
    const candidates = fresh
      ? boxes.filter(
          ({ box, score }) =>
            distanceToBox(mouth, box, width, height) / faceWidth <= config.waterObjectMaxDistance &&
            (score >= config.objectAcquireScore ||
              (expected !== null && sameObject(box, expected, width, height, faceWidth))),
        )
      : [];
    const objectCost = (box: ObjectBox) =>
      expected && sameObject(box, expected, width, height, faceWidth)
        ? length(center(box), center(expected), width, height)
        : faceWidth * 2 + distanceToBox(hand ?? mouth, box, width, height);
    const detected = candidates.reduce<ObjectBox | null>(
      (best, { box }) => (!best || objectCost(box) < objectCost(best) ? box : best),
      null,
    );
    // Between scheduled object inferences, align the cached box to the face.
    // A failed new inference can only be bridged with the associated live hand.
    const scheduled =
      anchor !== null &&
      objectTimestamp === anchor.objectObservedAt &&
      timestamp - objectTimestamp <= config.objectMaxAgeMs;
    const predicted =
      expected &&
      (scheduled || (hand !== null && anchor !== null && anchor.hand !== null)) &&
      distanceToBox(mouth, expected, width, height) / faceWidth <= config.waterObjectMaxDistance &&
      expected.x < 1 &&
      expected.y < 1 &&
      expected.x + expected.width > 0 &&
      expected.y + expected.height > 0
        ? expected
        : null;
    const object = detected ?? predicted;
    observation.object = object;
    if (!object) {
      observation.reason = "얼굴 가까이에 컵이나 병을 보여 주세요. 손은 잘려도 괜찮아요.";
      if (anchor && !continuous) observation.trackingChanged = true;
      return observation;
    }
    observation.objectEvidence = detected ? "detected" : "tracked";
    observation.objectObservedAt = detected ? objectTimestamp : anchor!.objectObservedAt;
    observation.objectOccluded = !detected && objectTimestamp > anchor!.objectObservedAt;
    // Only an associated gripping hand may move an occluded cup next frame.
    if (hand && distanceToBox(hand, object, width, height) / faceWidth > 0.5)
      observation.hand = null;
    if (
      anchor &&
      detected &&
      (!continuous || !expected || !sameObject(detected, expected, width, height, faceWidth))
    )
      observation.trackingChanged = true;
    // A large cup can touch the mouth while its gripping hand remains far away.
    observation.distance = distanceToBox(mouth, object, width, height) / faceWidth;
    observation.objectAtMouth = observation.distance <= config.waterEnterDistance;
    let inclination: number | null = null;
    let palmNormal: { x: number; y: number; z: number } | null = null;
    if (observation.hand) {
      const chosen = hands.landmarks
        .map((points) => ({
          points,
          palm: [0, 5, 9, 13, 17].map((i) => points[i]).filter(visible),
        }))
        .filter((h) => h.palm.length >= 3)
        .sort((a, b) => {
          const avg = (p: Point[]) => ({
            x: p.reduce((s, p) => s + p.x, 0) / p.length,
            y: p.reduce((s, p) => s + p.y, 0) / p.length,
          });
          return (
            length(avg(a.palm), observation.hand!, width, height) -
            length(avg(b.palm), observation.hand!, width, height)
          );
        })[0]?.points;
      if (chosen && [chosen[0], chosen[5], chosen[9], chosen[13], chosen[17]].every(visible)) {
        const wrist = chosen[0],
          mcp = [5, 9, 13, 17].map((i) => chosen[i]);
        const vx = (mcp.reduce((s, p) => s + p.x, 0) / 4 - wrist.x) * width;
        const vy = (mcp.reduce((s, p) => s + p.y, 0) / 4 - wrist.y) * height;
        const vz = (mcp.reduce((s, p) => s + (p.z ?? 0), 0) / 4 - (wrist.z ?? 0)) * width;
        const n = Math.hypot(vx, vy, vz),
          dx = (landmarks[454].x - landmarks[234].x) * width,
          dy = (landmarks[454].y - landmarks[234].y) * height;
        if (n >= 12 && Math.hypot(dx, dy) > 0) {
          inclination =
            (Math.acos(Math.max(-1, Math.min(1, (vx * dy - vy * dx) / (n * Math.hypot(dx, dy))))) *
              180) /
            Math.PI;
          const a = {
            x: (chosen[5].x - wrist.x) * width,
            y: (chosen[5].y - wrist.y) * height,
            z: ((chosen[5].z ?? 0) - (wrist.z ?? 0)) * width,
          };
          const b = {
            x: (chosen[17].x - wrist.x) * width,
            y: (chosen[17].y - wrist.y) * height,
            z: ((chosen[17].z ?? 0) - (wrist.z ?? 0)) * width,
          };
          const nx = a.y * b.z - a.z * b.y,
            ny = a.z * b.x - a.x * b.z,
            nz = a.x * b.y - a.y * b.x;
          const normalLength = Math.hypot(nx, ny, nz),
            faceLength = Math.hypot(dx, dy);
          if (normalLength >= 20)
            palmNormal = {
              x: (nx * dx + ny * dy) / (normalLength * faceLength),
              y: (nx * dy - ny * dx) / (normalLength * faceLength),
              z: nz / normalLength,
            };
        }
      }
    }
    observation.drinkMotion = {
      shapeReliable:
        object.x > 0.01 &&
        object.y > 0.01 &&
        object.x + object.width < 0.99 &&
        object.y + object.height < 0.99,
      handInclination: inclination,
      palmNormal,
      aspect: (object.width * width) / (object.height * height),
      lift: ((mouth.y - object.y - object.height / 2) * height) / faceWidth,
    };
  }
  observation.valid = true;
  observation.reason = observation.objectOccluded
    ? "컵이 잠깐 가려졌어요. 손의 움직임을 따라 연결하고 있어요."
    : "얼굴과 손을 확인했어요.";
  if (quest === "water" && !observation.objectOccluded)
    observation.reason = "얼굴과 컵·병을 확인했어요.";
  return observation;
}
