import { useDeviceStatus } from "./useDeviceStatus";
import { PixelIcon } from "./PixelIcon";

const connectionLabels: Record<string, string> = {
  wifi: "Wi-Fi",
  ethernet: "유선 네트워크",
  cellular: "모바일 네트워크",
  bluetooth: "블루투스 네트워크",
  wimax: "WiMAX",
};

export function StatusBar() {
  const { time, network, battery } = useDeviceStatus();
  const connected = network.online && network.type !== "none";
  const networkLabel = connected
    ? `${connectionLabels[network.type] ?? "네트워크"} 연결됨 (브라우저 기준)`
    : "네트워크 오프라인 (브라우저 기준)";
  const batteryLabel = battery
    ? `배터리 ${battery.percent}%${battery.charging ? ", 충전 중" : ""}`
    : "배터리 정보를 제공하지 않는 환경";

  return (
    <div className="status-bar" role="group" aria-label="기기 상태">
      <time className="device-time" aria-label={`현재 기기 시간 ${time}`} dateTime={time}>
        {time}
      </time>
      <div className="status-symbols">
        <span
          className="network-status"
          role="img"
          aria-label={networkLabel}
          title={networkLabel}
          data-online={connected}
        >
          <PixelIcon name="network" />
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
    </div>
  );
}
