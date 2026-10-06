import type {
  Detection,
  FaceLandmarkerResult,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { motionConfig as config } from "./config";
import type { MotionObservation, MotionQuest, ObjectBox, Point } from "./types";

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
  length(center(box), center(expected), width, height) / faceWidth <= 0.8 &&
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
    return observation;
  }
  const landmarks = face.faceLandmarks[0];
  const mouth = midpoint(landmarks[13], landmarks[14]);
  const faceWidth = length(landmarks[234], landmarks[454], width, height);
  observation.mouth = mouth;
  if (!visible(mouth) || faceWidth < 40) {
    observation.reason = "얼굴이 잘 보이도록 조금 가까이 앉아 주세요.";
    return observation;
  }
  const candidates = hands.landmarks
    .map((hand) => (quest === "medicine" ? midpoint(hand[4], hand[8]) : midpoint(hand[0], hand[9])))
    .filter(visible);
  if (!candidates.length) return observation;
  const boxes = detections.flatMap((detection) => {
    const box = detection.boundingBox;
    const label = detection.categories[0]?.categoryName;
    const score = detection.categories[0]?.score;
    if (
      !box ||
      !["cup", "bottle"].includes(label) ||
      !Number.isFinite(score) ||
      score < config.objectContinueScore ||
      box.width <= 0 ||
      box.height <= 0
    )
      return [];
    return [
      {
        score,
        box: {
          x: box.originX / width,
          y: box.originY / height,
          width: box.width / width,
          height: box.height / height,
          label,
        },
      },
    ];
  });
  const cost = (point: Point) =>
    previous?.hand
      ? length(point, previous.hand, width, height)
      : quest === "water" && boxes.length
        ? Math.min(...boxes.map(({ box }) => distanceToBox(point, box, width, height)))
        : length(point, mouth, width, height);
  const hand = candidates.reduce((best, point) => (cost(point) < cost(best) ? point : best));
  observation.hand = hand;
  observation.distance = length(hand, mouth, width, height) / faceWidth;
  if (previous?.hand && length(hand, previous.hand, width, height) / faceWidth > 1.5)
    observation.trackingChanged = true;
  if (previous?.mouth && length(mouth, previous.mouth, width, height) / faceWidth > 0.7)
    observation.trackingChanged = true;
  if (quest === "water") {
    const anchor =
      previous?.valid && previous.object && previous.hand && previous.objectObservedAt !== null
        ? {
            ...previous,
            object: previous.object,
            hand: previous.hand,
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
    const expected = continuous
      ? {
          ...anchor.object,
          x: anchor.object.x + hand.x - anchor.hand.x,
          y: anchor.object.y + hand.y - anchor.hand.y,
        }
      : null;
    const fresh =
      objectTimestamp <= timestamp &&
      timestamp - objectTimestamp <= config.objectMaxAgeMs &&
      (anchor === null || objectTimestamp > anchor.objectObservedAt);
    const candidates = fresh
      ? boxes.filter(
          ({ box, score }) =>
            distanceToBox(hand, box, width, height) / faceWidth <= 0.5 &&
            (score >= config.objectAcquireScore ||
              (expected !== null && sameObject(box, expected, width, height, faceWidth))),
        )
      : [];
    const objectCost = (box: ObjectBox) =>
      expected && sameObject(box, expected, width, height, faceWidth)
        ? length(center(box), center(expected), width, height)
        : faceWidth * 2 + distanceToBox(hand, box, width, height);
    const detected = candidates.reduce<ObjectBox | null>(
      (best, { box }) => (!best || objectCost(box) < objectCost(best) ? box : best),
      null,
    );
    // Only bridge a previously observed, hand-associated object. The original
    // observation time is preserved so repeated predictions cannot renew it.
    const predicted =
      expected &&
      expected.x < 1 &&
      expected.y < 1 &&
      expected.x + expected.width > 0 &&
      expected.y + expected.height > 0
        ? expected
        : null;
    const object = detected ?? predicted;
    observation.object = object;
    if (!object) {
      observation.reason = "손에 든 컵이나 병을 화면에 보여 주세요.";
      if (anchor && !continuous) observation.trackingChanged = true;
      return observation;
    }
    observation.objectEvidence = detected ? "detected" : "tracked";
    observation.objectObservedAt = detected ? objectTimestamp : anchor!.objectObservedAt;
    observation.objectOccluded = !detected && objectTimestamp > anchor!.objectObservedAt;
    if (
      anchor &&
      detected &&
      (!continuous || !expected || !sameObject(detected, expected, width, height, faceWidth))
    )
      observation.trackingChanged = true;
    // A large cup can touch the mouth while its gripping hand remains far away.
    observation.distance = distanceToBox(mouth, object, width, height) / faceWidth;
    observation.objectAtMouth = observation.distance <= config.waterEnterDistance;
  }
  observation.valid = true;
  observation.reason = observation.objectOccluded
    ? "컵이 잠깐 가려졌어요. 손의 움직임을 따라 연결하고 있어요."
    : "얼굴과 손을 확인했어요.";
  return observation;
}
