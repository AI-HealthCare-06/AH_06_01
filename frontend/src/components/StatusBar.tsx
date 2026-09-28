import { assets } from "../design/assets";
import { useDeviceStatus } from "./useDeviceStatus";

const connectionLabels: Record<string, string> = {
  wifi: "Wi-Fi",
  ethernet: "유선 네트워크",
  cellular: "모바일 네트워크",
  bluetooth: "블루투스 네트워크",
  wimax: "WiMAX",
};

export function StatusBar({ simple = false, camera }: { simple?: boolean; camera?: string }) {
  const { time, network, battery } = useDeviceStatus();
  const connected = network.online && network.type !== "none";
  const networkLabel = connected
    ? `${connectionLabels[network.type] ?? "네트워크"} 연결됨 (브라우저 기준)`
    : "네트워크 오프라인 (브라우저 기준)";
  const batteryLabel = battery
    ? `배터리 ${battery.percent}%${battery.charging ? ", 충전 중" : ""}`
    : "배터리 정보를 제공하지 않는 환경";

  return (
    <div className={`status-bar ${simple ? "simple" : ""}`} role="group" aria-label="기기 상태">
      <time className="device-time" aria-label={`현재 기기 시간 ${time}`} dateTime={time}>
        {time}
      </time>
      <img
        className="camera-dot"
        src={camera ?? assets.home.imgStatusCameraDot}
        alt=""
        aria-hidden="true"
      />
      {!simple && (
        <div className="status-symbols">
          <span
            className="network-status"
            role="img"
            aria-label={networkLabel}
            title={networkLabel}
            data-online={connected}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {connected && network.type === "wifi" ? (
                <>
                  <path d="M3 9a14 14 0 0 1 18 0M6 12.5a9 9 0 0 1 12 0M9 16a4.5 4.5 0 0 1 6 0" />
                  <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
                </>
              ) : (
                <>
                  <circle cx="12" cy="12" r="9" />
                  <ellipse cx="12" cy="12" rx="4" ry="9" />
                  <path d="M3 12h18" />
                  {!connected && <path d="m3 3 18 18" strokeWidth="2.5" />}
                </>
              )}
            </svg>
          </span>
          <span
            className={`battery-status ${battery ? "" : "unavailable"}`}
            role="img"
            aria-label={batteryLabel}
            title={batteryLabel}
          >
            <span className="battery-percent" aria-hidden="true">
              {battery ? `${battery.percent}%` : "—"}
            </span>
            <span className="battery" aria-hidden="true">
              {battery && <i style={{ width: `${battery.percent}%` }} />}
              {battery?.charging && (
                <svg className="charging-symbol" viewBox="0 0 12 16">
                  <path d="M7 1 2 9h4l-1 6 6-9H7z" />
                </svg>
              )}
              {!battery && <span className="battery-unknown">?</span>}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
