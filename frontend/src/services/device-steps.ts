import { Capacitor } from "@capacitor/core";
import { Health } from "@capgo/capacitor-health";
import { localDate } from "../domain/calendar";
import type { StepSnapshot } from "../domain/game";

export const stepPlatform = () => Capacitor.getPlatform();

export async function readDeviceSteps(requestPermission = false): Promise<StepSnapshot | null> {
  const platform = stepPlatform();
  if (platform !== "android" && platform !== "ios")
    throw new Error("걸음 수 자동 연동은 Android·iPhone 앱에서 사용할 수 있어요.");
  if (!(await Health.isAvailable()).available)
    throw new Error(
      platform === "android"
        ? "이 기기에서 Health Connect를 설치하거나 업데이트해 주세요."
        : "이 기기에서는 건강 데이터에 접근할 수 없어요.",
    );
  const options = { read: ["steps" as const], write: [] };
  const permission = await (requestPermission
    ? Health.requestAuthorization(options)
    : Health.checkAuthorization(options));
  // HealthKit intentionally hides read-denial status. An empty result is not a verified zero.
  if (platform === "android" && !permission.readAuthorized.includes("steps"))
    throw new Error("Health Connect 설정에서 걸음 수 읽기를 허용해 주세요.");
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  // Use native aggregation to avoid double counting phone/watch samples.
  const { samples } = await Health.queryAggregated({
    dataType: "steps",
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    bucket: "day",
    aggregation: "sum",
  });
  if (!samples.length) return null;
  if (
    samples.some(
      (sample) => sample.unit !== "count" || !Number.isFinite(sample.value) || sample.value < 0,
    )
  )
    throw new Error("걸음 수를 확인하지 못했어요. 잠시 후 다시 연결해 주세요.");
  return {
    date: localDate(end),
    count: Math.floor(samples.reduce((sum, sample) => sum + sample.value, 0)),
    source: platform === "android" ? "health-connect" : "healthkit",
    syncedAt: end.getTime(),
  };
}
