import { useState } from "react";
import { InfoDialog } from "./InfoDialog";
import { useProfileStore } from "../stores/profile-store";
import { cloudEnabled } from "../cloud/client";
import { useCloudStore } from "../cloud/sync";

export function BloodPressureEntry() {
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  function save() {
    const current = useProfileStore.getState();
    if (!current.recordBloodPressure(systolic, diastolic)) {
      setError("측정값을 확인해 주세요. 수축기는 이완기보다 큰 두세 자리 정수로 입력해 주세요.");
      return;
    }
    setTrigger(null);
    setStatus(
      !cloudEnabled
        ? "로컬 데모에 기록했어요."
        : !current.hasProfileInput
          ? "계정 저장은 건강 정보 등록 후 사용할 수 있어요."
          : !useCloudStore.getState().consent
            ? "서버 전송에는 저장 동의가 필요해요."
            : "기록했어요. 계정에 동기화하고 있어요.",
    );
  }
  return (
    <div className="blood-pressure-entry">
      <button
        className="blood-pressure-entry-button"
        type="button"
        onClick={(event) => {
          const current = useProfileStore.getState();
          const previous =
            (current.hasProfileInput || current.hasBloodPressureInput) &&
            current.profile.bloodPressure?.match(/^(\d+)\s*\/\s*(\d+)$/);
          setSystolic(previous ? previous[1] : "");
          setDiastolic(previous ? previous[2] : "");
          setError("");
          setStatus("");
          setTrigger(event.currentTarget);
        }}
      >
        혈압 기록
      </button>
      {status && <small role="status">{status}</small>}
      {trigger && (
        <InfoDialog
          title="혈압 바로 기록"
          onClose={() => setTrigger(null)}
          returnFocusTo={trigger}
          onConfirm={save}
          confirmLabel="기록 저장"
        >
          <p>측정기에 표시된 값을 입력해 주세요. 최근 혈압 값으로 반영돼요.</p>
          <form
            className="blood-pressure-fields"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label>
              수축기
              <input
                type="number"
                inputMode="numeric"
                aria-label="수축기 혈압"
                placeholder="수축기"
                min="10"
                max="999"
                step="1"
                value={systolic}
                onChange={(event) => {
                  setSystolic(event.target.value);
                  setError("");
                }}
              />
            </label>
            <label>
              이완기
              <input
                type="number"
                inputMode="numeric"
                aria-label="이완기 혈압"
                placeholder="이완기"
                min="10"
                max="999"
                step="1"
                value={diastolic}
                onChange={(event) => {
                  setDiastolic(event.target.value);
                  setError("");
                }}
              />
            </label>
            <span>mmHg · 직접 측정한 최근 값</span>
            {error && <p role="alert">{error}</p>}
            <button type="submit" hidden tabIndex={-1}>
              저장
            </button>
          </form>
        </InfoDialog>
      )}
    </div>
  );
}
