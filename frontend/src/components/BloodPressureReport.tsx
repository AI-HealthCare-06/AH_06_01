import { bloodPressurePresentation, rankerPresentation } from "../domain/risk-presentation";
import { chronicConditions } from "../domain/profile";
import { useProfileStore } from "../stores/profile-store";
import { BpStageCard } from "./BpStageCard";
import { BloodPressureEntry } from "./BloodPressureEntry";

export function BloodPressureReport({
  bp,
  ranker,
}: {
  bp?: unknown;
  model?: unknown;
  ranker?: unknown;
}) {
  const profile = useProfileStore((s) => s.profile);
  const hasProfileInput = useProfileStore((s) => s.hasProfileInput || s.hasBloodPressureInput);
  const pressure = bloodPressurePresentation(bp);
  const recommended = rankerPresentation(ranker);
  return (
    <section className="bp-report" aria-label="혈압 판정과 모델 참고 지표">
      <header>
        <h3>혈압 기록과 판정</h3>
        <BloodPressureEntry />
        <span>측정 혈압과 생활습관 추정은 별도로 확인해요</span>
      </header>
      <div className="bp-measurement">
        <div>
          <small>입력한 최근 혈압</small>
          <strong>{hasProfileInput ? (profile.bloodPressure ?? "모름") : "입력 대기"}</strong>
          <span>mmHg · 한 번 입력한 값</span>
        </div>
        <div>
          <small>7일 가정혈압 평균</small>
          <strong>
            {pressure.result?.home_sbp_avg_7d && pressure.result.home_dbp_avg_7d
              ? `${pressure.result.home_sbp_avg_7d} / ${pressure.result.home_dbp_avg_7d}`
              : "기록 대기"}
          </strong>
          <span>
            {typeof pressure.result?.valid_days_7d === "number"
              ? `유효 기록 ${pressure.result.valid_days_7d}일 / 7일`
              : "평균 기록 미연동"}
          </span>
        </div>
      </div>
      <p className={`bp-status ${pressure.tone}`}>
        <b>{pressure.label}</b>
        <span>{pressure.description}</span>
      </p>
      {pressure.result?.bp_target && <p>반환된 목표 혈압: {pressure.result.bp_target} mmHg</p>}
      <BpStageCard />
      <div className="ranker-status">
        <h4>Ranker 추천 순서</h4>
        {recommended.length ? (
          <ol>
            {recommended.map((quest) => (
              <li key={`${quest.priority}-${quest.quest_id}`}>
                <b>우선순위 {quest.priority}</b> · {quest.reason}
              </li>
            ))}
          </ol>
        ) : (
          <p>추천 서비스 연결 후 표시돼요. 퀘스트 완료 기록과 의료 판정은 별도로 관리해요.</p>
        )}
      </div>
      {(profile.specialHistory ||
        profile.conditions.some((code) => !chronicConditions.some(([key]) => key === code)) ||
        profile.age < 18 ||
        profile.pregnancyStatus === "pregnant" ||
        profile.pregnancyStatus === "postpartum_6w") && (
        <p className="special-history-note">
          개별 확인이 필요한 건강 정보가 있어요. 희귀 질환·특수 이력·임신·소아 정보는 일반 성인 모델
          결과만으로 판단하지 않아요.
        </p>
      )}
    </section>
  );
}
