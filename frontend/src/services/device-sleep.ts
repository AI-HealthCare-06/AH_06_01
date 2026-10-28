import { Capacitor } from "@capacitor/core";
import { Health, type HealthSample } from "@capgo/capacitor-health";
import { localDate } from "../domain/calendar";

export function verifiedSleepMinutes(samples: HealthSample[], now = new Date()) {
  const intervals: [number, number][] = [];
  const earliest = now.getTime() - 24 * 60 * 60_000;
  const asleep = new Set(["asleep", "light", "deep", "rem"]);
  for (const sample of samples) {
    const start = Date.parse(sample.startDate),
      end = Date.parse(sample.endDate);
    if (
      sample.dataType !== "sleep" ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      end > now.getTime() ||
      localDate(new Date(end)) !== localDate(now)
    )
      continue;
    // Session durations without sleep stages can include awake/in-bed time; do not certify those.
    const stages = sample.stages?.length
      ? sample.stages
      : sample.sleepState
        ? [{ startDate: sample.startDate, endDate: sample.endDate, stage: sample.sleepState }]
        : [];
    for (const stage of stages) {
      if (!asleep.has(stage.stage)) continue;
      const a = Math.max(start, earliest, Date.parse(stage.startDate));
      const b = Math.min(end, Date.parse(stage.endDate));
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) intervals.push([a, b]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0,
    until = -Infinity;
  for (const [start, end] of intervals) {
    total += Math.max(0, end - Math.max(start, until));
    until = Math.max(until, end);
  }
  return Math.floor(total / 60_000);
}

export async function readDeviceSleep(requestPermission = false) {
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios")
    throw new Error("수면 인증은 건강 앱과 연결된 모바일 앱에서 사용할 수 있어요.");
  if (!(await Health.isAvailable()).available)
    throw new Error("Health Connect를 설치하거나 업데이트해 주세요.");
  const options = { read: ["sleep" as const], write: [] };
  const permission = await (requestPermission
    ? Health.requestAuthorization(options)
    : Health.checkAuthorization(options));
  if (platform === "android" && !permission.readAuthorized.includes("sleep"))
    throw new Error(
      "수면 읽기 권한을 허용해 주세요. 기존 APK에서 권한이 없으면 새 APK가 필요해요.",
    );
  const now = new Date();
  const { samples } = await Health.readSamples({
    dataType: "sleep",
    startDate: new Date(now.getTime() - 36 * 60 * 60_000).toISOString(),
    endDate: now.toISOString(),
    limit: 1000,
  });
  const minutes = verifiedSleepMinutes(samples, now);
  if (!minutes)
    throw new Error(
      "오늘 끝난 실제 수면 단계 기록이 없어요. 삼성 헬스·워치의 수면 공유를 확인해 주세요.",
    );
  return {
    minutes,
    date: localDate(now),
    source: platform === "android" ? ("health-connect" as const) : ("healthkit" as const),
  };
}
