import { describe, expect, it } from "vitest";
import type {
  Detection,
  FaceLandmarkerResult,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { extractObservation } from "./features";
import { MotionDetector } from "./detector";
import type { MotionObservation } from "./types";

function landmarks() {
  const face: FaceLandmarkerResult = {
    faceLandmarks: [Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.4, z: 0, visibility: 1 }))],
    faceBlendshapes: [],
    facialTransformationMatrixes: [],
  };
  face.faceLandmarks[0][234].x = 0.25;
  face.faceLandmarks[0][454].x = 0.75;
  const hands: HandLandmarkerResult = {
    landmarks: [Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6, z: 10, visibility: 1 }))],
    worldLandmarks: [],
    handedness: [],
    handednesses: [],
  };
  return { face, hands };
}
function cup(y = 0.45, score = 0.7, height = 0.25, x = 0.45): Detection {
  return {
    boundingBox: {
      originX: x * 640,
      originY: y * 480,
      width: 0.15 * 640,
      height: height * 480,
      angle: 0,
    },
    categories: [{ categoryName: "cup", displayName: "cup", index: 41, score }],
    keypoints: [],
  };
}
function moveHand(hands: HandLandmarkerResult, y: number, x = 0.5) {
  hands.landmarks[0].forEach((point) => {
    point.y = y;
    point.x = x;
  });
}

describe("camera feature geometry", () => {
  it("normalizes pixel distance by face width instead of mixing x/y units or model z", () => {
    const { face, hands } = landmarks();
    const feature = extractObservation("medicine", face, hands, [], 100, 640, 480, null);
    expect(feature.valid).toBe(true);
    expect(feature.distance).toBeCloseTo(0.3);
  });

  it("requires a visible cup or bottle for the water mode", () => {
    const { face, hands } = landmarks();
    expect(extractObservation("water", face, hands, [], 100, 640, 480, null).valid).toBe(false);
  });

  it("withholds classification when more than one face is visible", () => {
    const { face, hands } = landmarks();
    face.faceLandmarks.push(face.faceLandmarks[0]);
    const feature = extractObservation("medicine", face, hands, [], 100, 640, 480, null);
    expect(feature.valid).toBe(false);
    expect(feature.trackingChanged).toBe(true);
  });

  it("uses the cup-mouth distance when a large cup's gripping hand stays far away", () => {
    const { face, hands } = landmarks();
    moveHand(hands, 0.95);
    const feature = extractObservation(
      "water",
      face,
      hands,
      [cup(0.35, 0.7, 0.6)],
      100,
      640,
      480,
      null,
    );
    expect(feature.valid).toBe(true);
    expect(feature.distance).toBe(0);
    expect(feature.objectAtMouth).toBe(true);
  });

  it("accepts a weaker detection only when it continues an already observed cup", () => {
    const { face, hands } = landmarks();
    expect(
      extractObservation("water", face, hands, [cup(0.45, 0.3)], 100, 640, 480, null).valid,
    ).toBe(false);
    const first = extractObservation("water", face, hands, [cup()], 100, 640, 480, null);
    moveHand(hands, 0.5);
    const continued = extractObservation(
      "water",
      face,
      hands,
      [cup(0.35, 0.3)],
      300,
      640,
      480,
      first,
    );
    expect(continued.valid).toBe(true);
    expect(continued.objectEvidence).toBe("detected");
    expect(continued.objectObservedAt).toBe(300);
    expect(continued.trackingChanged).toBe(false);
  });

  it("translates a hidden cup with the live hand and never renews its original detection time", () => {
    const { face, hands } = landmarks();
    let feature = extractObservation("water", face, hands, [cup()], 100, 640, 480, null);
    moveHand(hands, 0.55);
    for (const timestamp of [300, 600, 1000, 1400]) {
      feature = extractObservation("water", face, hands, [], timestamp, 640, 480, feature);
      expect(feature.valid).toBe(true);
      expect(feature.objectEvidence).toBe("tracked");
      expect(feature.objectOccluded).toBe(true);
      expect(feature.objectObservedAt).toBe(100);
      expect(feature.object?.y).toBeCloseTo(0.4);
    }
    const expired = extractObservation("water", face, hands, [], 1700, 640, 480, feature);
    expect(expired.valid).toBe(false);
    expect(expired.object).toBeNull();
    expect(expired.trackingChanged).toBe(true);
  });

  it("does not report a scheduled detection interval as an occlusion or a fresh observation", () => {
    const { face, hands } = landmarks();
    const first = extractObservation("water", face, hands, [cup()], 100, 640, 480, null);
    moveHand(hands, 0.55);
    const scheduled = extractObservation("water", face, hands, [cup()], 200, 640, 480, first, 100);
    expect(scheduled.objectEvidence).toBe("tracked");
    expect(scheduled.objectOccluded).toBe(false);
    expect(scheduled.objectObservedAt).toBe(100);
    expect(scheduled.object?.y).toBeCloseTo(0.4);
  });

  it("does not follow an unrelated weak cup or predict a cup without a visible hand", () => {
    const { face, hands } = landmarks();
    const first = extractObservation("water", face, hands, [cup()], 100, 640, 480, null);
    const unrelated = extractObservation(
      "water",
      face,
      hands,
      [cup(0.45, 0.3, 0.25, 0.05)],
      300,
      640,
      480,
      first,
    );
    expect(unrelated.objectEvidence).toBe("tracked");
    expect(unrelated.objectObservedAt).toBe(100);
    expect(unrelated.object?.x).toBeCloseTo(0.45);
    hands.landmarks = [];
    const missingHand = extractObservation("water", face, hands, [], 400, 640, 480, first);
    expect(missingHand.valid).toBe(false);
    expect(missingHand.object).toBeNull();
  });

  it("discards the cup anchor when the tracked hand jumps", () => {
    const { face, hands } = landmarks();
    face.faceLandmarks[0][234].x = 0.4;
    face.faceLandmarks[0][454].x = 0.6;
    const first = extractObservation("water", face, hands, [cup()], 100, 640, 480, null);
    moveHand(hands, 0.6, 0.9);
    const changed = extractObservation("water", face, hands, [], 200, 640, 480, first);
    expect(changed.valid).toBe(false);
    expect(changed.trackingChanged).toBe(true);
  });

  it("completes a visible approach, occluded drinking hold and visibly reacquired return", () => {
    const { face, hands } = landmarks();
    face.faceLandmarks[0][234].x = 0.375;
    face.faceLandmarks[0][454].x = 0.625;
    const detector = new MotionDetector("water", true);
    let previous: MotionObservation | null = null;
    const frame = (timestamp: number, handY: number, detections: Detection[]) => {
      moveHand(hands, handY);
      const feature = extractObservation(
        "water",
        face,
        hands,
        detections,
        timestamp,
        640,
        480,
        previous,
      );
      if (feature.valid) previous = feature;
      return detector.update(feature);
    };
    for (let timestamp = 0; timestamp <= 400; timestamp += 100)
      frame(timestamp, 0.9, [cup(0.8, 0.7, 0.1)]);
    expect(frame(500, 0.5, [cup(0.35, 0.3, 0.25)]).stage).toBe("at_mouth");
    for (let timestamp = 600; timestamp <= 1400; timestamp += 100) {
      expect(frame(timestamp, 0.5, []).stage).not.toBe("detected");
    }
    expect(frame(1500, 0.9, [cup(0.8, 0.7, 0.1)]).stage).toBe("returning");
    frame(1600, 0.9, [cup(0.8, 0.7, 0.1)]);
    expect(frame(1700, 0.9, [cup(0.8, 0.7, 0.1)]).stage).toBe("detected");
  });
});
