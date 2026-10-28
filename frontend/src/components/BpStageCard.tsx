import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { cloudEnabled } from "../cloud/client";
import { useCloudStore } from "../cloud/sync";
import {
  bpStages,
  bpStageLabels,
  bpStagePresentation,
  healthSnapshotKey,
  bpStageInputLabels,
} from "../domain/bp-stage";
import { useGameStore } from "../stores/game-store";
import { useProfileStore } from "../stores/profile-store";
import { useMedicationStore } from "../stores/medication-store";
import { loadBpStage } from "../services/bp-stage";
import "../bp-stage.css";

export function BpStageCard({ compact = false }: { compact?: boolean }) {
  const cloud = useCloudStore();
  const { profile, hasProfileInput } = useProfileStore();
  const medications = useMedicationStore((s) => s.medications);
  const date = useGameStore((s) => s.game.date);
  const dailySurveys = useGameStore((s) => s.game.dailySurveys);
  const current = healthSnapshotKey(hasProfileInput ? profile : undefined, medications, {
    date,
    dailySurveys,
  });
  const ready =
    cloudEnabled &&
    cloud.ready &&
    Boolean(cloud.userId) &&
    cloud.consent &&
    current !== null &&
    current === cloud.healthSnapshotKey &&
    !cloud.healthSyncPending;
  const query = useQuery({
    queryKey: ["bp-stage", cloud.userId, cloud.healthSnapshotKey],
    queryFn: () => loadBpStage(cloud.userId!),
    enabled: ready,
    staleTime: 300_000,
    gcTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  // Hide cached results immediately on consent revocation/account/profile changes.
  const result = ready ? query.data : undefined;
  const presentation = result ? bpStagePresentation(result) : null;
  const missing = result?.missing_inputs ?? [];
  const firstMissing = missing[0];
  const section =
    firstMissing === "fasting_glucose"
      ? "measurements"
      : firstMissing === "diabetes_flag"
        ? "conditions"
        : firstMissing === "family_htn"
          ? "family"
          : firstMissing === "alcohol_week"
            ? "alcohol"
            : ["waist_cm", "resting_hr", "education_years"].includes(firstMissing)
              ? "analysis"
              : ["sleep_hours", "activity_minutes_week"].includes(firstMissing)
                ? "lifestyle"
                : "";
  const state = !cloudEnabled
    ? "모델 결과 대기"
    : !cloud.consent
      ? "서버 저장 동의 후 분석할 수 있어요"
      : !hasProfileInput
        ? "프로필을 입력해 주세요"
        : !ready
          ? "건강 기록 서버 저장 확인 중"
          : query.isError
            ? "분석에 연결하지 못했어요"
            : "생활습관 참고 분석 중";
  return (
    <section
      className={`bp-stage-card ${compact ? "compact" : ""}`}
      aria-label="생활습관 기반 혈압 단계 참고"
    >
      <h4>생활습관 참고 분석</h4>
      <strong aria-live="polite">{presentation?.label ?? state}</strong>
      {presentation && <p>{presentation.description}</p>}
      {result?.data_quality === "insufficient" && missing.length > 0 && (
        <p>추가할 수 있는 정보: {missing.map((key) => bpStageInputLabels[key]).join(" · ")}</p>
      )}
      {!compact && result?.stage_probs && (
        <dl className="bp-stage-distribution" aria-label="혈압 단계별 참고 분포">
          {bpStages.map((stage) => (
            <div key={stage}>
              <dt>{bpStageLabels[stage]}</dt>
              <dd>
                <span className="bp-stage-track">
                  <span style={{ width: `${result.stage_probs![stage] * 100}%` }} />
                </span>
                <b>{(result.stage_probs![stage] * 100).toFixed(1)}%</b>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!compact && presentation && presentation.reasons.length > 0 && (
        <p>확인할 입력 항목: {presentation.reasons.join(" · ")}</p>
      )}
      {!compact && result && (
        <small>
          모델 {result.model_version} · 계약 {result.feature_version}
        </small>
      )}
      {result?.stage_probs && (
        <small>측정 혈압 판정·건강 점수·미래 발병 가능성과 구분되는 추정 분포예요.</small>
      )}
      {ready && query.isError && (
        <button type="button" onClick={() => void query.refetch()}>
          다시 연결
        </button>
      )}
      {(!hasProfileInput ||
        result?.data_quality === "insufficient" ||
        result?.data_quality === "out_of_range") && (
        <Link to={`/profile?mode=edit${section ? `&section=${section}` : ""}`}>
          건강 정보 확인하기 ›
        </Link>
      )}
      {!cloudEnabled && <small>실제 로그인된 서버 환경에서 분석 결과를 표시해요.</small>}
    </section>
  );
}
