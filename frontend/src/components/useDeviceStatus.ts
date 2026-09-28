import { useEffect, useState } from "react";

type DeviceBattery = EventTarget & { level: number; charging: boolean };
type DeviceConnection = EventTarget & { type?: string };
type DeviceNavigator = Navigator & {
  getBattery?: () => Promise<DeviceBattery>;
  connection?: DeviceConnection;
};
type BatteryStatus = { percent: number; charging: boolean } | null;

function localTime() {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

function networkStatus() {
  const browser = navigator as DeviceNavigator;
  return { online: browser.onLine, type: browser.connection?.type ?? "unknown" };
}

export function useDeviceStatus() {
  const [time, setTime] = useState(localTime);
  const [network, setNetwork] = useState(networkStatus);
  const [battery, setBattery] = useState<BatteryStatus>(null);

  useEffect(() => {
    const browser = navigator as DeviceNavigator;
    const connection = browser.connection;
    let disposed = false;
    let manager: DeviceBattery | undefined;

    function updateBattery() {
      if (!manager || disposed) return;
      setBattery(
        Number.isFinite(manager.level)
          ? {
              percent: Math.round(Math.max(0, Math.min(1, manager.level)) * 100),
              charging: manager.charging,
            }
          : null,
      );
    }
    function updateNetwork() {
      setNetwork(networkStatus());
    }
    function refresh() {
      setTime(localTime());
      updateNetwork();
      updateBattery();
    }

    const timer = window.setInterval(() => setTime(localTime()), 1000);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    connection?.addEventListener("change", updateNetwork);

    // Browsers may omit this API or reject it under their security policy.
    async function connectBattery() {
      try {
        const result = await browser.getBattery?.();
        if (!result || disposed) return;
        manager = result;
        updateBattery();
        manager.addEventListener("levelchange", updateBattery);
        manager.addEventListener("chargingchange", updateBattery);
      } catch {
        // Keep the unavailable state instead of displaying a made-up charge.
      }
    }
    void connectBattery();

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      connection?.removeEventListener("change", updateNetwork);
      manager?.removeEventListener("levelchange", updateBattery);
      manager?.removeEventListener("chargingchange", updateBattery);
    };
  }, []);

  return { time, network, battery };
}
