import { PixelTimePicker } from "./PixelTimePicker";
import { SurveyChoices, SurveyHelp } from "./SurveyControls";
import type { PressureMetadata } from "../domain/blood-pressure-history";

export function BloodPressureMetadataFields({
  date,
  label,
  value,
  onChange,
}: {
  date: string;
  label: string;
  value: PressureMetadata;
  onChange: (value: PressureMetadata) => void;
}) {
  const change = (patch: Partial<PressureMetadata>) => onChange({ ...value, ...patch });
  const time = value.measuredAt
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value.measuredAt))
    : "";
  return (
    <details className="bp-measurement-metadata">
      <summary>
        {label} 측정 정보 <span>선택</span>
      </summary>
      <div>
        <SurveyHelp
          label={`${label} 측정 정보`}
          text="직접 확인한 측정 시각·장소·혈압계를 기록해요. 모르는 항목은 그대로 두어도 제출할 수 있어요. 휴대폰 기기를 혈압계로 자동 등록하지 않아요."
        />
        <SurveyChoices
          label={`${label} 측정 시각 확인`}
          value={value.timePrecision}
          onChange={(v) =>
            change({
              timePrecision: v as PressureMetadata["timePrecision"],
              measuredAt: v === "day" ? null : value.measuredAt,
            })
          }
          choices={[
            { value: "day", label: "시각 모름" },
            { value: "minute", label: "시각 입력" },
          ]}
        />
        {value.timePrecision === "minute" && (
          <label className="daily-survey-field">
            {label} 측정 시각
            <PixelTimePicker
              label={`${label} 측정 시각`}
              value={time}
              onChange={(t) =>
                change({ measuredAt: t ? new Date(`${date}T${t}:00+09:00`).toISOString() : null })
              }
            />
          </label>
        )}
        <SurveyChoices
          label={`${label} 측정 장소`}
          value={value.setting}
          onChange={(v) => change({ setting: v as PressureMetadata["setting"] })}
          choices={[
            { value: "unknown", label: "모름" },
            { value: "home", label: "가정" },
            { value: "clinic", label: "병원·의원" },
          ]}
        />
        <SurveyChoices
          label={`${label} 혈압계 종류`}
          value={value.method}
          onChange={(v) => change({ method: v as PressureMetadata["method"] })}
          choices={[
            { value: "unknown", label: "모름" },
            { value: "upper-arm-cuff", label: "위팔 커프" },
            { value: "wrist", label: "손목" },
            { value: "other", label: "기타" },
          ]}
        />
        <label className="daily-survey-field">
          {label} 혈압계 이름
          <input
            aria-label={`${label} 혈압계 이름`}
            maxLength={80}
            placeholder="예: 집 혈압계 · 모르면 비워두세요"
            value={value.deviceLabel ?? ""}
            onChange={(e) => change({ deviceLabel: e.target.value.trim() || null })}
          />
        </label>
        <SurveyChoices
          label={`${label} 측정 자세 확인`}
          value={value.protocolConfirmed === null ? "unknown" : String(value.protocolConfirmed)}
          onChange={(v) => change({ protocolConfirmed: v === "unknown" ? null : v === "true" })}
          choices={[
            { value: "unknown", label: "미확인" },
            { value: "true", label: "안정 후 바른 자세" },
            { value: "false", label: "조건이 달랐어요" },
          ]}
        />
      </div>
    </details>
  );
}
