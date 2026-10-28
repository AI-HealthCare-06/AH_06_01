import { describe, it, expect } from "vitest";
import { InjectionDetector, injectionPoint, sampleInjection } from "./injection";
const region = { x: 0.5, y: 0.6, radius: 0.12 };
describe("experimental injection-site hand sequence", () => {
  it("detects approach, dwell and withdrawal without claiming tool or needle recognition", () => {
    const detector = new InjectionDetector(region);
    let progress;
    for (let t = 0; t < 7000; t += 100) progress = detector.update(sampleInjection(t, t));
    expect(progress!.stage).toBe("detected");
    expect(progress!.process?.completedSteps).toEqual(["site_hand"]);
  });
  it("rejects a static hand, a passing hand, and a missing withdrawal", () => {
    for (const mode of ["static", "pass", "no_return"]) {
      const detector = new InjectionDetector(region);
      let progress;
      for (let t = 0; t < 7000; t += 100) {
        const frame = sampleInjection(
          mode === "static" ? 2500 : mode === "no_return" ? Math.min(t, 3000) : t,
          t,
        );
        if (mode === "pass" && t > 2200) frame.hands = [{ x: 0.18, y: 0.6 }];
        progress = detector.update(frame);
      }
      expect(progress!.stage).not.toBe("detected");
    }
  });
  it("resets after missing or discontinuous hand tracking", () => {
    for (const mode of ["missing", "jump"]) {
      const detector = new InjectionDetector(region);
      let progress;
      for (let t = 0; t < 7000; t += 100) {
        const frame = sampleInjection(t, t);
        if (t >= 2600 && t < 3900) frame.hands = mode === "missing" ? [] : [{ x: 0.95, y: 0.05 }];
        progress = detector.update(frame);
      }
      expect(progress!.stage).not.toBe("detected");
    }
  });
  it("maps mirrored preview taps and rejects letterbox taps", () => {
    const box = { left: 0, top: 0, width: 300, height: 400 };
    expect(injectionPoint(75, 200, box, 640, 480)).toEqual({ x: 0.75, y: 0.5, radius: 0.12 });
    expect(injectionPoint(75, 30, box, 640, 480)).toBeNull();
  });
});
