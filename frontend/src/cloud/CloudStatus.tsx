import { useState } from "react";
import { InfoDialog } from "../components/InfoDialog";
import { cloudEnabled } from "./client";
import { capture, cloudConsent, enableQuestPush, flushCloud, useCloudStore } from "./sync";
export function CloudStatus() {
  const s = useCloudStore();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  if (!cloudEnabled) return null;
  return (
    <>
      <button
        className="cream-card settings-summary-row"
        onClick={(e) => setTrigger(e.currentTarget)}
      >
        <span>
          <strong>계정 데이터 동기화</strong>
          <small>{s.consent ? `서버 저장 켜짐 · 대기 ${s.pending}건` : "이 기기에 저장 중"}</small>
        </span>
        <b aria-hidden="true">›</b>
      </button>
      {trigger && (
        <InfoDialog
          title="계정 데이터 동기화"
          returnFocusTo={trigger}
          onClose={() => setTrigger(null)}
          confirmLabel="닫기"
        >
          <div className="cloud-status settings-detail">
            <p>{s.email}</p>
            <p role="status">{s.message}</p>
            <p>
              전송 대기 {s.pending}건 · 마지막 서버 확인{" "}
              {s.lastAck ? new Date(s.lastAck).toLocaleString("ko-KR") : "아직 없음"}
            </p>
            <label>
              <input
                type="checkbox"
                checked={s.consent}
                onChange={(e) => cloudConsent(e.target.checked)}
              />{" "}
              건강 프로필·복약·걸음 수·퀘스트 기록을 AWS 수집 API를 거쳐 Supabase(서울)에 저장하고,
              저장한 생활습관·신체 정보로 참고 분석을 제공하는 데 동의합니다.
            </label>
            <small>동의를 끄면 이후 전송을 중단해요. 이미 저장된 기록은 유지돼요.</small>
            <button
              className="secondary-button"
              disabled={!s.consent}
              onClick={() => {
                capture();
                void flushCloud();
              }}
            >
              지금 서버에 저장
            </button>
            <p>{s.pushMessage}</p>
            <button
              className="secondary-button"
              onClick={() =>
                void enableQuestPush().catch(() =>
                  useCloudStore.setState({
                    pushMessage: "푸시 설정에 실패했어요. 다시 시도해 주세요.",
                  }),
                )
              }
            >
              퀘스트 푸시 알림 켜기
            </button>
            <p>
              앱을 다시 열면 로컬 경과 시간만큼 전투를 계산해요(최대 24시간). 로그아웃 중에는
              진행하지 않아요.
            </p>
          </div>
        </InfoDialog>
      )}
    </>
  );
}
