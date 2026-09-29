export type Weather = { temperature: number; code: number; day: boolean; updatedAt: number };
export function weatherMessage(weather: Weather) {
  const { code, temperature, day } = weather;
  if (code >= 95) return "천둥·번개가 있어요. 실내에서 함께해요.";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "눈이 내려요. 미끄러운 길을 조심해요.";
  if (code >= 51) return "비가 내려요. 우산을 챙겨 주세요.";
  if (code === 45 || code === 48) return "안개가 있어요. 주변을 살펴보세요.";
  if (temperature >= 30) return "더운 날이에요. 시원하게 쉬어 가요.";
  if (temperature <= 0) return "추운 날이에요. 따뜻하게 입어요.";
  if (!day) return "편안한 밤, 오늘도 수고했어요.";
  return code <= 1 ? "맑은 날, 오늘도 가볍게 움직여요!" : "구름 낀 날도 건강한 하루 보내요!";
}
export async function currentWeather(latitude: number, longitude: number): Promise<Weather> {
  // Only coarse coordinates are sent to the public forecast provider, never stored.
  const query = new URLSearchParams({
    latitude: latitude.toFixed(2),
    longitude: longitude.toFixed(2),
    current: "temperature_2m,weather_code,is_day",
    timezone: "auto",
    forecast_days: "1",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("날씨를 불러오지 못했어요. 다시 시도해 주세요.");
  const { current } = await response.json();
  if (
    !current ||
    typeof current.temperature_2m !== "number" ||
    !Number.isFinite(current.temperature_2m) ||
    typeof current.weather_code !== "number" ||
    ![0, 1].includes(current.is_day)
  )
    throw new Error("날씨 정보를 확인할 수 없어요.");
  return {
    temperature: current.temperature_2m,
    code: current.weather_code,
    day: current.is_day === 1,
    updatedAt: Date.now(),
  };
}
