import { describe, expect, it } from "vitest";
import { ProcessDetector } from "./process";
import { sampleProcess } from "./process-sample";
import type { ProcessObservation } from "./types";

function replay(
  detector: ProcessDetector,
  make: (time: number) => ProcessObservation,
  end = 10_000,
) {
  let last;
  for (let time = 0; time <= end; time += 100) last = detector.update(make(time));
  return last!;
}
describe("front-camera visible process recognition", () => {
  it("recognizes the visible drinking cycle after the cup has returned", () => {
    const detector = new ProcessDetector("water", true);
    expect(
      replay(detector, (time) => sampleProcess("water", time, time)).process?.completedSteps,
    ).toEqual(["drink"]);
  });
  it("requires the hand cycle followed by a fresh full drinking cycle for oral medication", () => {
    const detector = new ProcessDetector("medicine", true);
    const progress = replay(detector, (time) => sampleProcess("medicine", time, time));
    expect(progress.stage).toBe("detected");
    expect(progress.process?.completedSteps).toEqual(["hand", "drink"]);
    const events = progress.process!.trace.map((item) => item.event);
    expect(events.indexOf("hand_complete")).toBeLessThan(events.indexOf("drink_complete"));
  });
  it("does not turn drinking alone into a medication process", () => {
    const progress = replay(new ProcessDetector("medicine", true), (time) => {
      const frame = sampleProcess("water", time, time);
      return { ...frame, hand: { ...frame.hand, distance: frame.drink.distance, pinchRatio: 0.2 } };
    });
    expect(progress.stage).not.toBe("detected");
  });
  it("does not accept a hand-to-mouth cycle without subsequent drinking", () => {
    const progress = replay(new ProcessDetector("medicine", true), (time) => {
      const frame = sampleProcess("medicine", time, time);
      return { ...frame, drink: { ...frame.drink, valid: false, distance: null, object: null } };
    });
    expect(progress.process?.completedSteps).toEqual(["hand"]);
    expect(progress.stage).not.toBe("detected");
  });
  it("rejects open-palm face touches and no-preparation sequences", () => {
    const progress = replay(new ProcessDetector("medicine", true), (time) => {
      const frame = sampleProcess("medicine", time, time);
      return { ...frame, hand: { ...frame.hand, pinchRatio: 1.5 } };
    });
    expect(progress.process?.completedSteps).toEqual([]);
    expect(
      replay(new ProcessDetector("medicine", false), (time) =>
        sampleProcess("medicine", time, time),
      ).stage,
    ).not.toBe("detected");
  });
  it("rejects a stationary cup at the mouth without approach and return", () => {
    const progress = replay(new ProcessDetector("water", true), (time) => {
      const frame = sampleProcess("water", 2200, time);
      return frame;
    });
    expect(progress.stage).not.toBe("detected");
  });
  it("clears the hand phase after a person switch or interrupted stream", () => {
    for (const interrupt of ["person", "gap"] as const) {
      const detector = new ProcessDetector("medicine", true);
      replay(detector, (time) => sampleProcess("medicine", time, time), 4700);
      expect(
        detector.update(sampleProcess("medicine", 4700, 4800)).process?.completedSteps,
      ).toEqual(["hand"]);
      const restarted = sampleProcess("medicine", 5000, interrupt === "gap" ? 7000 : 4900);
      if (interrupt === "person") restarted.hand.faceTrackingChanged = true;
      expect(detector.update(restarted).process?.completedSteps).toEqual([]);
    }
  });
  it("discards a completed hand phase when the face disappears for more than the grace window", () => {
    const detector = new ProcessDetector("medicine", true);
    replay(detector, (time) => sampleProcess("medicine", time, time), 4700);
    let progress;
    for (let time = 4800; time <= 6500; time += 100) {
      const frame = sampleProcess("medicine", 4700, time);
      frame.hand = { ...frame.hand, valid: false, mouth: null, faceWidth: null };
      frame.drink = { ...frame.drink, valid: false, mouth: null, faceWidth: null };
      progress = detector.update(frame);
    }
    expect(progress!.process?.completedSteps).toEqual([]);
    expect(progress!.process?.trace.some((item) => item.event === "reset")).toBe(true);
  });
  it("expires a stale hand phase rather than combining unrelated later drinking", () => {
    const detector = new ProcessDetector("medicine", true);
    replay(detector, (time) => sampleProcess("medicine", time, time), 4700);
    for (let time = 4800; time <= 40_000; time += 100)
      detector.update(sampleProcess("water", 0, time));
    expect(detector.update(sampleProcess("water", 2200, 40_100)).process?.completedSteps).toEqual(
      [],
    );
  });
  it("cannot advance by duplicated frames or mismatched sensor timestamps", () => {
    const detector = new ProcessDetector("medicine", true);
    const frame = sampleProcess("medicine", 0, 100);
    for (let index = 0; index < 100; index++) detector.update(frame);
    const mismatched = sampleProcess("medicine", 2500, 200);
    mismatched.drink.timestamp = 201;
    expect(detector.update(mismatched).stage).not.toBe("detected");
  });
});

it("handles five-fps mobile input while refusing severely sparse observations", () => {
  for (const cadence of [100, 200, 400]) {
    const detector = new ProcessDetector("medicine", true);
    let progress;
    for (let time = 0; time <= 12000; time += cadence)
      progress = detector.update(sampleProcess("medicine", time, time));
    if (cadence <= 200) expect(progress!.stage).toBe("detected");
    else expect(progress!.stage).not.toBe("detected");
  }
});
