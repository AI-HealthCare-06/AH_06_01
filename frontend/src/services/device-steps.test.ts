import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  platform: "android",
  available: true,
  granted: true,
  samples: [] as { value: number; unit: string }[],
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => native.platform } }));
vi.mock("@capgo/capacitor-health", () => ({
  Health: {
    isAvailable: vi.fn(async () => ({ available: native.available })),
    requestAuthorization: vi.fn(async () => ({ readAuthorized: native.granted ? ["steps"] : [] })),
    checkAuthorization: vi.fn(async () => ({ readAuthorized: native.granted ? ["steps"] : [] })),
    queryAggregated: vi.fn(async () => ({ samples: native.samples })),
  },
}));
import { Health } from "@capgo/capacitor-health";
import { readDeviceSteps } from "./device-steps";
describe("native device step adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.platform = "android";
    native.available = true;
    native.granted = true;
    native.samples = [{ value: 6050, unit: "count" }];
  });
  it("requests only step read access and uses native aggregation", async () => {
    expect(await readDeviceSteps(true)).toMatchObject({ count: 6050, source: "health-connect" });
    expect(Health.requestAuthorization).toHaveBeenCalledWith({ read: ["steps"], write: [] });
    expect(Health.queryAggregated).toHaveBeenCalledWith(
      expect.objectContaining({ dataType: "steps", aggregation: "sum", bucket: "day" }),
    );
  });
  it("does not call native APIs in a web browser", async () => {
    native.platform = "web";
    await expect(readDeviceSteps(true)).rejects.toThrow("앱");
    expect(Health.isAvailable).not.toHaveBeenCalled();
  });
  it("handles denied Android permissions without reading data", async () => {
    native.granted = false;
    await expect(readDeviceSteps()).rejects.toThrow("허용");
    expect(Health.queryAggregated).not.toHaveBeenCalled();
  });
  it("does not infer HealthKit denial or zero from empty samples", async () => {
    native.platform = "ios";
    native.granted = false;
    native.samples = [];
    expect(await readDeviceSteps()).toBeNull();
    native.samples = [{ value: 3200, unit: "count" }];
    expect(await readDeviceSteps()).toMatchObject({ count: 3200, source: "healthkit" });
  });
  it("rejects invalid native measurements", async () => {
    native.samples = [{ value: NaN, unit: "count" }];
    await expect(readDeviceSteps()).rejects.toThrow("확인");
  });
});
