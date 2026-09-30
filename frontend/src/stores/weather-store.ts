import { create } from "zustand";
import { currentWeather } from "../services/weather";
import type { Weather } from "../services/weather";

export const useWeatherStore = create<{
  weather: Weather | null;
  busy: boolean;
  error: string;
  load: () => Promise<void>;
}>((set, get) => ({
  weather: null,
  busy: false,
  error: "",
  load: async () => {
    if (get().busy) return;
    set({ busy: true, error: "" });
    try {
      if (!navigator.geolocation) throw new Error("이 환경에서는 위치를 확인할 수 없어요.");
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10_000,
          maximumAge: 600_000,
        }),
      );
      const weather = await currentWeather(position.coords.latitude, position.coords.longitude);
      set({ weather });
    } catch (error) {
      set({
        weather: null,
        error: error instanceof Error ? error.message : "위치 권한을 허용하면 날씨를 볼 수 있어요.",
      });
    } finally {
      set({ busy: false });
    }
  },
}));
