import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { HealthSample } from "@capgo/capacitor-health";
const native = vi.hoisted(() => ({
  platform: "android",
  granted: true,
  samples: [] as HealthSample[],
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => native.platform } }));
vi.mock("@capgo/capacitor-health", () => ({
  Health: {
    isAvailable: vi.fn(async () => ({ available: true })),
    requestAuthorization: vi.fn(async () => ({ readAuthorized: native.granted ? ["sleep"] : [] })),
    checkAuthorization: vi.fn(async () => ({ readAuthorized: native.granted ? ["sleep"] : [] })),
    readSamples: vi.fn(async () => ({ samples: native.samples })),
  },
}));
import { Health } from "@capgo/capacitor-health";
import { readDeviceSleep, verifiedSleepMinutes } from "./device-sleep";
const now = new Date("2026-10-22T09:00:00");
const sample = (start = "2026-10-21T23:00:00", end = "2026-10-22T07:00:00"): HealthSample => ({
  dataType: "sleep",
  startDate: start,
  endDate: end,
  value: 480,
  unit: "minute",
  sleepState: "asleep",
});
describe("sleep evidence from device health records", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    native.platform = "android";
    native.granted = true;
    native.samples = [sample()];
  });
  afterEach(() => vi.useRealTimers());
  it("merges overlapping phone/watch intervals instead of doubling sleep", () => {
    expect(
      verifiedSleepMinutes([sample(), sample("2026-10-22T01:00:00", "2026-10-22T06:00:00")], now),
    ).toBe(480);
  });
  it("excludes awake, in-bed and unclassified session durations", () => {
    const s = sample();
    expect(
      verifiedSleepMinutes(
        [
          { ...s, sleepState: "awake" },
          { ...s, sleepState: "inBed" },
          { ...s, sleepState: undefined },
        ],
        now,
      ),
    ).toBe(0);
    expect(
      verifiedSleepMinutes(
        [
          {
            ...s,
            stages: [
              {
                startDate: "2026-10-21T23:00:00",
                endDate: "2026-10-22T06:00:00",
                stage: "light",
                durationMinutes: 420,
              },
              {
                startDate: "2026-10-22T06:00:00",
                endDate: "2026-10-22T07:00:00",
                stage: "awake",
                durationMinutes: 60,
              },
            ],
          },
        ],
        now,
      ),
    ).toBe(420);
  });
  it("rejects future or previous-day sessions", () => {
    expect(
      verifiedSleepMinutes(
        [
          sample("2026-10-20T23:00:00", "2026-10-21T07:00:00"),
          sample("2026-10-21T23:00:00", "2026-10-22T10:00:00"),
        ],
        now,
      ),
    ).toBe(0);
  });
  it("requests only sleep read permission and returns measured minutes", async () => {
    expect(await readDeviceSleep(true)).toMatchObject({
      minutes: 480,
      source: "health-connect",
      date: "2026-10-22",
    });
    expect(Health.requestAuthorization).toHaveBeenCalledWith({ read: ["sleep"], write: [] });
  });
  it("does not read denied data or certify empty samples", async () => {
    native.granted = false;
    await expect(readDeviceSleep()).rejects.toThrow("권한");
    expect(Health.readSamples).not.toHaveBeenCalled();
    native.granted = true;
    native.samples = [];
    await expect(readDeviceSleep()).rejects.toThrow("기록이 없어요");
  });
  it("keeps native health-store reads out of browser previews", async () => {
    native.platform = "web";
    await expect(readDeviceSleep(true)).rejects.toThrow("모바일 앱");
    expect(Health.requestAuthorization).not.toHaveBeenCalled();
  });
});
