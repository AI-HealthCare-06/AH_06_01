import { isNewerVersion } from "../domain/mobile-update";
import { useState } from "react";
import { InfoDialog } from "./InfoDialog";
import { Capacitor } from "@capacitor/core";
import { checkMobileUpdates, useMobileUpdateStore } from "../services/mobile-updates";
import { GameLoadingScreen } from "./GameLoadingScreen";

export function MobileUpdateStatus() {
  const { phase, currentVersion, nextVersion, availableVersion } = useMobileUpdateStore();
  const [openedFromPush, setOpenedFromPush] = useState(() =>
    new URLSearchParams(location.search).has("updates"),
  );
  const available = !!availableVersion && isNewerVersion(availableVersion, currentVersion);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  if (Capacitor.getPlatform() !== "android") return null;
  const messages = {
    unconfigured: "업데이트 서버 연결을 준비하고 있어요.",
    idle: "새 버전을 자동으로 확인해요.",
    checking: "새 버전을 확인하고 있어요.",
    downloading: "새 버전을 다운로드한 뒤 자동으로 적용해요.",
    ready: `v${nextVersion} 준비 완료 · 앱으로 돌아오면 바로 적용해요.`,
    applying: `v${nextVersion}을 적용하고 있어요. 잠시만 기다려 주세요.`,
    offline: "업데이트를 확인하지 못했어요. 현재 버전은 계속 이용할 수 있어요.",
  };
  return (
    <>
      <button
        className={`cream-card settings-summary-row${available ? " update-available" : ""}`}
        data-update-available={available}
        onClick={(e) => setTrigger(e.currentTarget)}
      >
        <span>
          <strong>앱 업데이트{available && " · NEW"}</strong>
          <small>
            현재 v{currentVersion}
            {["downloading", "applying"].includes(phase)
              ? " · 업데이트 중"
              : phase === "ready"
                ? " · 적용 준비"
                : ""}
          </small>
        </span>
        <b aria-hidden="true">›</b>
      </button>
      {(trigger || openedFromPush) && (
        <InfoDialog
          title="앱 업데이트"
          returnFocusTo={trigger}
          onClose={() => {
            setTrigger(null);
            setOpenedFromPush(false);
          }}
          confirmLabel="닫기"
        >
          <div className="mobile-update-card settings-detail">
            <p>현재 v{currentVersion}</p>
            <p role="status">{messages[phase]}</p>
            <button
              className="secondary-button"
              disabled={["unconfigured", "checking", "downloading", "applying"].includes(phase)}
              onClick={() => void checkMobileUpdates(true)}
            >
              업데이트 확인
            </button>
          </div>
        </InfoDialog>
      )}
    </>
  );
}

export function MobileUpdateOverlay() {
  const { phase, nextVersion, progress } = useMobileUpdateStore();
  if (Capacitor.getPlatform() !== "android" || !["downloading", "applying"].includes(phase))
    return null;
  return (
    <GameLoadingScreen
      stage={phase === "applying" ? "applying" : "downloading"}
      progress={progress}
      version={nextVersion}
    />
  );
}
