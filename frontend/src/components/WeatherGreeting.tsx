import { useEffect } from "react";
import { weatherMessage } from "../services/weather";
import { useWeatherStore } from "../stores/weather-store";
import { useNotice } from "./NoticeProvider";
import { PixelIcon } from "./PixelIcon";

export function WeatherGreeting() {
  const { weather, busy, load } = useWeatherStore();
  const notice = useNotice();
  const icon = !weather
    ? "sun"
    : [71, 73, 75, 77, 85, 86].includes(weather.code)
      ? "snow"
      : weather.code >= 51
        ? "rain"
        : !weather.day
          ? "moon"
          : weather.code >= 2
            ? "cloud"
            : "sun";
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const last = useWeatherStore.getState().weather;
      if (last && Date.now() - last.updatedAt < 30 * 60_000) return;
      try {
        if ((await navigator.permissions.query({ name: "geolocation" })).state === "granted")
          await load();
      } catch {
        /* The explicit button also works without the Permissions API. */
      }
    };
    void refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [load]);
  return (
    <div className="weather-greeting">
      <button
        disabled={busy}
        aria-label="내 위치 날씨 새로고침"
        title="위치를 허용하면 Open-Meteo 날씨를 불러와요"
        onClick={async () => {
          await load();
          const error = useWeatherStore.getState().error;
          if (error) notice(error);
        }}
      >
        <PixelIcon name={icon} />
        <span>
          {busy
            ? "날씨를 확인하고 있어요…"
            : weather
              ? weatherMessage(weather)
              : "내 위치의 날씨를 확인해 보세요"}
        </span>
      </button>
      {weather && (
        <small>
          {Math.round(weather.temperature)}°C ·{" "}
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            Open-Meteo
          </a>
        </small>
      )}
    </div>
  );
}
