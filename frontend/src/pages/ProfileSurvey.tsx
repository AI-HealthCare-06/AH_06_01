import { PixelSelect } from "../components/PixelSelect";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ScenarioShell } from "../components/AppShell";
import { MedicationEditor } from "../components/MedicationEditor";
import { useNotice } from "../components/NoticeProvider";
import { assets } from "../design/assets";
import { bmi, chronicConditions, conditionLabel, profileSchema } from "../domain/profile";
import { medicationListSchema } from "../domain/medications";
import { useProfileStore } from "../stores/profile-store";
import { useMedicationStore } from "../stores/medication-store";
import { useSessionStore } from "../stores/session-store";
import { useGameStore } from "../stores/game-store";
import { cloudEnabled } from "../cloud/client";
import { cloudConsent, useCloudStore } from "../cloud/sync";
import { profileQuests, profileQuestDeadline, type ProfileQuestId } from "../domain/profile-quests";

const steps = ["기본 정보", "혈압 / 공복 혈당", "앓고 있는 지병", "생활습관 / 가족력"];
const pages = [
  { title: steps[0], group: 0 },
  { title: steps[1], group: 1 },
  { title: steps[2], group: 2 },
  { title: "그 밖의 만성질환", group: 2 },
  { title: "특수 이력 / 치료 상태", group: 2 },
  { title: "복용 중인 약과 시간", group: 2 },
  { title: "생활습관", group: 3 },
  { title: "음주 습관", group: 3 },
  { title: "추가 분석 정보", group: 3 },
  { title: "가족력", group: 3 },
  { title: "확인하고 완료", group: 3 },
];
export function ProfileSurvey() {
  const { profile, setProfile, onboardingCompleted, hasProfileInput } = useProfileStore();
  const [params] = useSearchParams();
  const candidate = params.get("mode") === "quest" ? params.get("quest") : null;
  const questId: ProfileQuestId | null =
    onboardingCompleted && (candidate === "conditions" || candidate === "lifestyle")
      ? candidate
      : null;
  const editing = !questId && onboardingCompleted && params.get("mode") !== "signup";
  const basicFlow = !editing && !questId;
  const flow = basicFlow
    ? [0, 1, 10]
    : questId === "conditions"
      ? [2, 3, 4, 5, 10]
      : questId === "lifestyle"
        ? [6, 7, 8, 9, 10]
        : pages.map((_, index) => index);
  const [pageIndex, setPageIndex] = useState(() => {
    const sections: Record<string, number> = {
      measurements: 1,
      conditions: 2,
      lifestyle: 6,
      alcohol: 7,
      analysis: 8,
      family: 9,
    };
    return editing ? Math.max(0, flow.indexOf(sections[params.get("section") ?? ""] ?? 0)) : 0;
  });
  const step = flow[pageIndex];
  const currentPage = pages[step];
  const lastPage = pageIndex === flow.length - 1;
  const progressSteps = basicFlow
    ? ["기본 정보", "혈압 정보", "확인"]
    : questId
      ? [profileQuests.find((q) => q.id === questId)!.title, "확인"]
      : steps;
  const progressGroup = basicFlow ? pageIndex : questId ? (lastPage ? 1 : 0) : currentPage.group;
  const profileQuestProgress = useGameStore((state) => state.game.profileQuests);
  const [editingMedication, setEditingMedication] = useState(false);
  const [draft, setDraft] = useState(() => ({
    ...profile,
    ...(basicFlow && !hasProfileInput
      ? {
          bloodPressure: null,
          glucose: null,
          smoking: null,
          hypertensionFamily: null,
          diabetesFamily: null,
          alcoholDays: null,
          alcoholWeek: null,
          bingeMonthly: null,
          sleepHours: null,
          activeMinutesWeek: null,
          familyHistory: [],
          conditionStatus: "unknown" as const,
        }
      : {}),
    // Legacy [] already meant "none"; persist that answer even when its radio is already checked.
    conditionStatus: profile.conditions.length
      ? ("selected" as const)
      : (profile.conditionStatus ?? "none"),
  }));
  // Keep existing cm values untouched unless the user edits the inch input.
  const [waistInches, setWaistInches] = useState(() =>
    profile.waistCm === null || profile.waistCm === undefined
      ? ""
      : String(Number((profile.waistCm / 2.54).toFixed(2))),
  );
  const knownMeasurements = useRef({
    bloodPressure: draft.bloodPressure ?? "",
    glucose: draft.glucose ?? NaN,
  });
  const [medications, setMedications] = useState(useMedicationStore.getState().medications);
  const [customCondition, setCustomCondition] = useState("");
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(useCloudStore.getState().consent);
  const heading = useRef<HTMLHeadingElement>(null);
  const answeredPages = useRef(new Set<number>());
  const notice = useNotice();
  const navigate = useNavigate();
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const schema =
      step === 0
        ? profileSchema.pick({ name: true, age: true, sex: true, height: true, weight: true })
        : step === 1
          ? basicFlow
            ? profileSchema.pick({ bloodPressure: true, htnStatus: true })
            : profileSchema.pick({ bloodPressure: true, glucose: true })
          : step === 2 || step === 3
            ? profileSchema.pick({ conditions: true })
            : step === 4
              ? profileSchema.pick({
                  conditions: true,
                  specialHistory: true,
                  pregnancyStatus: true,
                  htnStatus: true,
                })
              : step === 5
                ? profileSchema.pick({})
                : step === 6
                  ? profileSchema.pick({
                      smoking: true,
                      alcoholDays: true,
                      sleepHours: true,
                      activeMinutesWeek: true,
                    })
                  : step === 7
                    ? profileSchema.pick({ alcoholWeek: true, bingeMonthly: true })
                    : step === 8
                      ? profileSchema.pick({
                          waistCm: true,
                          restingHeartRate: true,
                          educationYears: true,
                        })
                      : step === 9
                        ? profileSchema.pick({
                            hypertensionFamily: true,
                            diabetesFamily: true,
                            familyHistory: true,
                          })
                        : profileSchema;
    const result = schema.safeParse(draft);
    const meds = medicationListSchema.safeParse(medications);
    if (editingMedication) {
      setError("등록 중인 약을 저장하거나 취소한 뒤 다음으로 이동해 주세요.");
      return;
    }
    if (step === 4 && draft.conditionStatus === "selected" && !draft.conditions.length) {
      setError(
        "진단받은 질환을 선택하거나 기타 질환을 추가해 주세요. 모르면 ‘모름’을 선택해 주세요.",
      );
      return;
    }
    if (!result.success || !meds.success) {
      setError(
        !result.success
          ? result.error.issues[0].message
          : !meds.success
            ? meds.error.issues[0].message
            : "입력값을 확인해 주세요.",
      );
      return;
    }
    answeredPages.current.add(step);
    setError("");
    if (!lastPage) {
      setPageIndex(pageIndex + 1);
      return;
    }
    const completed = profileSchema.parse(draft);
    if (cloudEnabled && !consent) {
      setError("서버 저장을 위한 건강 정보 처리 동의를 확인해 주세요.");
      return;
    }
    if (basicFlow && onboardingCompleted) useProfileStore.getState().clear();
    setProfile(completed);
    if (!basicFlow) useMedicationStore.getState().replaceMedications(meds.data);
    useSessionStore.getState().signIn();
    useGameStore.getState().resumeSession();
    if (cloudEnabled) cloudConsent(true);
    const completedIds: ProfileQuestId[] = questId
      ? [questId]
      : editing
        ? (["conditions", "lifestyle"] as const).filter((id) =>
            (id === "conditions" ? [2, 3, 4, 5] : [6, 7, 8, 9]).every((page) =>
              answeredPages.current.has(page),
            ),
          )
        : [];
    let reward = 0;
    for (const id of completedIds) reward += useGameStore.getState().finishProfileQuest(id) ?? 0;
    notice(
      questId
        ? reward > 0
          ? "기록 퀘스트 완료! +" + reward + " EXP"
          : "건강 정보를 저장했어요. 이미 완료했거나 보상 기간이 지난 퀘스트는 EXP를 다시 지급하지 않아요."
        : editing
          ? "건강 정보를 변경했어요." + (reward > 0 ? " +" + reward + " EXP" : "")
          : "기본 정보와 혈압 정보를 저장했어요. 지병·생활습관은 첫 주 퀘스트로 기록해요.",
    );
    navigate(questId ? "/quests" : editing ? "/home" : "/dinosaur");
  }
  function toggleCondition(code: string) {
    const conditions = draft.conditions.includes(code)
      ? draft.conditions.filter((item) => item !== code)
      : [...draft.conditions, code];
    setDraft({
      ...draft,
      conditions,
      conditionStatus: conditions.length ? "selected" : "unknown",
    });
  }
  return (
    <ScenarioShell
      className="profile-screen survey-screen"
      background={assets.profile.imgHealthBackgroundPixelOcean}
    >
      <header className="profile-heading">
        <div className="profile-title-row">
          <h1>
            {questId
              ? profileQuests.find((q) => q.id === questId)!.title
              : editing
                ? "건강 정보 수정"
                : "건강 프로필"}
          </h1>
          <span aria-label="설문 페이지">
            {pageIndex + 1} / {flow.length}
          </span>
        </div>
        <h2 ref={heading} tabIndex={-1}>
          {basicFlow && step === 1 ? "혈압 정보" : currentPage.title}
        </h2>
        <p>
          {questId
            ? "기록을 마치면 퀘스트 목록으로 돌아가요."
            : editing
              ? "변경 내용을 저장하면 홈으로 돌아가요."
              : "나를 위한 건강 모험, 한 단계씩 준비해요."}
        </p>
      </header>
      <ol className="survey-progress" aria-label="설문 진행 단계">
        {progressSteps.map((label, index) => (
          <li
            key={label}
            aria-current={progressGroup === index ? "step" : undefined}
            className={index <= progressGroup ? "done" : ""}
          >
            <span>{index + 1}</span>
            <small>{label}</small>
          </li>
        ))}
      </ol>
      {questId && (
        <p className="profile-quest-note">
          최초 로그인부터 7일 · {profileQuestDeadline(profileQuestProgress)}까지 완료하면 +200 EXP를
          한 번 받아요. 모르는 항목은 모름으로 기록해도 돼요.
        </p>
      )}
      <form className="profile-form" onSubmit={submit}>
        {step === 0 && (
          <fieldset className="profile-section">
            <legend>이름, 나이, 성별, 키, 몸무게</legend>
            <div className="profile-grid">
              <label className="survey-wide">
                이름
                <div className="health-input">
                  <input
                    aria-label="이름"
                    autoComplete="given-name"
                    required
                    maxLength={40}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
              </label>
              <label>
                나이
                <div className="health-input">
                  <input
                    aria-label="나이"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={120}
                    required
                    value={Number.isFinite(draft.age) ? draft.age : ""}
                    onChange={(e) => setDraft({ ...draft, age: e.target.valueAsNumber })}
                  />
                  <span>세</span>
                </div>
              </label>
              <label>
                성별
                <div className="health-select">
                  <PixelSelect
                    aria-label="성별"
                    value={draft.sex}
                    onValueChange={(value) =>
                      setDraft({ ...draft, sex: value as "female" | "male" })
                    }
                  >
                    <option value="female">여성</option>
                    <option value="male">남성</option>
                  </PixelSelect>
                </div>
              </label>
              <label>
                키
                <div className="health-input">
                  <input
                    aria-label="키"
                    type="number"
                    inputMode="decimal"
                    min={50}
                    max={250}
                    step="0.1"
                    required
                    value={Number.isFinite(draft.height) ? draft.height : ""}
                    onChange={(e) => setDraft({ ...draft, height: e.target.valueAsNumber })}
                  />
                  <span>cm</span>
                </div>
              </label>
              <label>
                몸무게
                <div className="health-input">
                  <input
                    aria-label="몸무게"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={500}
                    step="0.1"
                    required
                    value={Number.isFinite(draft.weight) ? draft.weight : ""}
                    onChange={(e) => setDraft({ ...draft, weight: e.target.valueAsNumber })}
                  />
                  <span>kg</span>
                </div>
              </label>
            </div>
            <div className="cream-card bmi-card">
              <div>
                <small>나의 BMI</small>
                <strong>
                  {Number.isFinite(draft.weight) ? bmi(draft.height, draft.weight) : "—"}
                </strong>
              </div>
              <span>
                입력한 키와 몸무게로
                <br />
                자동 계산해요.
              </span>
            </div>
          </fieldset>
        )}
        {step === 1 && (
          <fieldset className="profile-section">
            <legend>최근 건강 측정값</legend>
            <p className="profile-section-note">
              값을 모르면 ‘모름’을 선택해 주세요. 한 번의 혈압 입력으로 진단을 확정하지 않아요.
            </p>
            <div className="profile-grid profile-measurements">
              <div className="measurement-field">
                <div className="measurement-label-row">
                  <label htmlFor="blood-pressure">혈압</label>
                  <label className="unknown-measurement">
                    <input
                      type="checkbox"
                      aria-label="혈압 모름"
                      checked={draft.bloodPressure === null}
                      onChange={(e) => {
                        if (e.target.checked)
                          knownMeasurements.current.bloodPressure = draft.bloodPressure ?? "";
                        setDraft({
                          ...draft,
                          bloodPressure: e.target.checked
                            ? null
                            : knownMeasurements.current.bloodPressure,
                        });
                      }}
                    />
                    <span>모름</span>
                  </label>
                </div>
                <div className="health-input pressure-input">
                  <input
                    id="blood-pressure"
                    aria-label="혈압"
                    type="text"
                    placeholder="120 / 80"
                    aria-describedby="blood-pressure-hint"
                    required={draft.bloodPressure !== null}
                    disabled={draft.bloodPressure === null}
                    value={draft.bloodPressure ?? ""}
                    onChange={(e) => setDraft({ ...draft, bloodPressure: e.target.value })}
                  />
                  <span>mmHg</span>
                </div>
                <small id="blood-pressure-hint" className="field-hint">
                  수축기 / 이완기 순서 · 예: 120 / 80
                </small>
              </div>
              {!basicFlow && (
                <>
                  <div className="measurement-field">
                    <div className="measurement-label-row">
                      <label htmlFor="fasting-glucose">공복 혈당</label>
                      <label className="unknown-measurement">
                        <input
                          type="checkbox"
                          aria-label="공복 혈당 모름"
                          checked={draft.glucose === null}
                          onChange={(e) => {
                            if (e.target.checked)
                              knownMeasurements.current.glucose = draft.glucose ?? NaN;
                            setDraft({
                              ...draft,
                              glucose: e.target.checked ? null : knownMeasurements.current.glucose,
                            });
                          }}
                        />
                        <span>모름</span>
                      </label>
                    </div>
                    <div className="health-input">
                      <input
                        id="fasting-glucose"
                        aria-label="공복 혈당"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={1000}
                        disabled={draft.glucose === null}
                        required={draft.glucose !== null}
                        value={Number.isFinite(draft.glucose) ? (draft.glucose ?? "") : ""}
                        onChange={(e) => setDraft({ ...draft, glucose: e.target.valueAsNumber })}
                      />
                      <span>mg/dL</span>
                    </div>
                  </div>
                </>
              )}
            </div>
            {basicFlow && (
              <>
                <label className="survey-text-field">
                  고혈압 진단·치료 상태
                  <PixelSelect
                    aria-label="고혈압 진단·치료 상태"
                    value={draft.htnStatus}
                    onValueChange={(value) =>
                      setDraft({ ...draft, htnStatus: value as typeof draft.htnStatus })
                    }
                  >
                    <option value="unknown">모름</option>
                    <option value="none">진단 없음</option>
                    <option value="diagnosed_untreated">진단받았으나 약 복용 안 함</option>
                    <option value="on_medication">약 복용 중</option>
                  </PixelSelect>
                </label>
              </>
            )}
            <p className="profile-section-note">
              가정혈압 판정에는 최소 5일·12회 이상의 유효 기록이 필요해요. 측정 기록이 충분해질
              때까지 판정은 보류돼요.
            </p>
          </fieldset>
        )}
        {(step === 2 || step === 3) && (
          <fieldset className="profile-section" key={step}>
            <legend>앓고 있는 지병</legend>
            <p className="profile-section-note">
              질환이 없으면 ‘없음’, 확인하지 못했다면 ‘모름’을 선택해 주세요. ‘없음’도 정상 응답으로
              저장해요.
            </p>
            <div className="health-option-row">
              <span id="condition-status-label">지병·기저질환 여부</span>
              <div
                className="health-options"
                role="radiogroup"
                aria-labelledby="condition-status-label"
              >
                {(
                  [
                    ["none", "없음"],
                    ["selected", "있음"],
                    ["unknown", "모름"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="conditionStatus"
                      checked={
                        (draft.conditionStatus ??
                          (draft.conditions.length ? "selected" : "none")) === value
                      }
                      onChange={() =>
                        setDraft({
                          ...draft,
                          conditionStatus: value,
                          conditions: value === "selected" ? draft.conditions : [],
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="condition-grid">
              {chronicConditions
                .slice(step === 2 ? 0 : 8, step === 2 ? 8 : 16)
                .map(([code, label]) => (
                  <label key={code}>
                    <input
                      type="checkbox"
                      checked={draft.conditions.includes(code)}
                      onChange={() => toggleCondition(code)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
            </div>
            <p className="profile-section-note">
              선택한 질환 {draft.conditions.length}개 · 다음 페이지에서도 이어서 선택해요.
            </p>
          </fieldset>
        )}
        {step === 4 && (
          <fieldset className="profile-section">
            <legend>기타 질환과 주의사항</legend>
            <label className="survey-custom-condition">
              목록에 없는 질환 / 희귀 유전병
              <div className="custom-condition-input">
                <input
                  aria-label="추가 지병 이름"
                  maxLength={80}
                  placeholder="직접 입력"
                  value={customCondition}
                  onChange={(e) => setCustomCondition(e.target.value)}
                />
                <button
                  type="button"
                  disabled={!customCondition.trim() || draft.conditions.length >= 30}
                  onClick={() => {
                    const label = customCondition.trim();
                    if (!draft.conditions.includes(label))
                      setDraft({
                        ...draft,
                        conditions: [...draft.conditions, label],
                        conditionStatus: "selected",
                      });
                    setCustomCondition("");
                  }}
                >
                  추가
                </button>
              </div>
            </label>
            <ul className="custom-condition-list">
              {draft.conditions
                .filter((code) => !chronicConditions.some(([key]) => key === code))
                .map((label) => (
                  <li key={label}>
                    <span>{label}</span>
                    <button
                      type="button"
                      aria-label={`${label} 제거`}
                      onClick={() => toggleCondition(label)}
                    >
                      ×
                    </button>
                  </li>
                ))}
            </ul>
            <label className="survey-text-field">
              특수 이력 / 주의사항
              <textarea
                aria-label="특수 이력 / 주의사항"
                rows={3}
                maxLength={1500}
                placeholder="유전성 질환, 수술·실신 이력, 주치의의 주의사항 등을 적어 주세요."
                value={draft.specialHistory}
                onChange={(e) => setDraft({ ...draft, specialHistory: e.target.value })}
              />
            </label>
            <label className="survey-text-field">
              고혈압 진단·치료 상태
              <PixelSelect
                aria-label="고혈압 진단·치료 상태"
                value={draft.htnStatus}
                onValueChange={(value) =>
                  setDraft({ ...draft, htnStatus: value as typeof draft.htnStatus })
                }
              >
                <option value="unknown">모름</option>
                <option value="none">진단 없음</option>
                <option value="diagnosed_untreated">진단받았으나 약 복용 안 함</option>
                <option value="on_medication">약 복용 중</option>
              </PixelSelect>
            </label>
            {draft.sex === "female" && (
              <label className="survey-text-field">
                임신 관련 상태
                <PixelSelect
                  aria-label="임신 관련 상태"
                  value={draft.pregnancyStatus}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      pregnancyStatus: value as typeof draft.pregnancyStatus,
                    })
                  }
                >
                  <option value="unknown">모름 / 응답 안 함</option>
                  <option value="none">해당 없음</option>
                  <option value="pregnant">임신 중</option>
                  <option value="postpartum_6w">출산 후 6주 이내</option>
                </PixelSelect>
              </label>
            )}
          </fieldset>
        )}
        {step === 5 && (
          <fieldset className="profile-section">
            <legend>복용 중인 약과 시간</legend>
            <MedicationEditor
              paged
              onEditingChange={setEditingMedication}
              value={medications}
              onChange={setMedications}
              conditions={draft.conditions.map(conditionLabel)}
            />
          </fieldset>
        )}
        {(step === 6 || step === 9) && (
          <fieldset className="profile-section">
            <legend>{currentPage.title}</legend>
            <div className="health-toggles">
              {(
                [
                  { key: "smoking", label: "흡연 여부" },
                  { key: "hypertensionFamily", label: "고혈압 가족력" },
                  { key: "diabetesFamily", label: "당뇨 가족력" },
                ] as const
              )
                .filter(({ key }) => (step === 6 ? key === "smoking" : key !== "smoking"))
                .map(({ key, label }) => (
                  <div className="health-option-row" key={key}>
                    <span id={`${key}-label`}>{label}</span>
                    <div
                      className="health-options"
                      role="radiogroup"
                      aria-labelledby={`${key}-label`}
                    >
                      {([false, true, null] as const).map((value) => (
                        <label key={String(value)}>
                          <input
                            type="radio"
                            name={key}
                            checked={draft[key] === value}
                            onChange={() =>
                              setDraft({
                                ...draft,
                                [key]: value,
                                familyHistory:
                                  key === "smoking" || value === true
                                    ? draft.familyHistory
                                    : draft.familyHistory.filter(
                                        (item) =>
                                          item !==
                                          (key === "hypertensionFamily"
                                            ? "hypertension"
                                            : "diabetes"),
                                      ),
                              })
                            }
                          />
                          <span>
                            {value === null
                              ? "모름"
                              : key === "smoking"
                                ? value
                                  ? "예"
                                  : "아니요"
                                : value
                                  ? "있음"
                                  : "없음"}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
            {step === 6 && (
              <div className="profile-grid survey-lifestyle">
                {(
                  [
                    { key: "alcoholDays", label: "주당 음주 일수", unit: "일", max: 7 },
                    { key: "sleepHours", label: "하루 수면 시간", unit: "시간", max: 24 },
                    { key: "activeMinutesWeek", label: "주당 활동 시간", unit: "분", max: 10080 },
                  ] as const
                ).map(({ key, label, unit, max }) => (
                  <label key={key}>
                    {label}
                    <div className="health-input">
                      <input
                        aria-label={label}
                        type="number"
                        min={0}
                        max={max}
                        step={key === "sleepHours" ? "0.5" : "1"}
                        inputMode="decimal"
                        placeholder="모름"
                        value={draft[key] ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [key]: e.target.value === "" ? null : e.target.valueAsNumber,
                          })
                        }
                      />
                      <span>{unit}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
            {step === 9 && (
              <>
                <h3>추가 가족력</h3>
                <div className="condition-grid">
                  {(
                    [
                      ["stroke", "뇌졸중 가족력"],
                      ["mi_early", "조기 심근경색 가족력"],
                    ] as const
                  ).map(([code, label]) => (
                    <label key={code}>
                      <input
                        type="checkbox"
                        checked={draft.familyHistory.includes(code)}
                        onChange={() =>
                          setDraft({
                            ...draft,
                            familyHistory: draft.familyHistory.includes(code)
                              ? draft.familyHistory.filter((item) => item !== code)
                              : [...draft.familyHistory, code],
                          })
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            <p className="profile-section-note">
              모르는 생활습관 값은 비워도 돼요. 희귀 질환·특수 이력은 일반 모델에 자동 대입하지 않고
              진료 상담을 위한 별도 정보로 남겨요.
            </p>
          </fieldset>
        )}
        {step === 7 && (
          <fieldset className="profile-section">
            <legend>음주 습관</legend>
            <p className="profile-section-note">
              음주 일수와 마신 양은 다른 정보예요. 모르는 값은 비워도 돼요.
            </p>
            <label className="survey-text-field">
              주당 표준잔 수
              <div className="health-input">
                <input
                  aria-label="주당 표준잔 수"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={60}
                  step="0.5"
                  disabled={draft.alcoholDays === 0}
                  placeholder="모름"
                  value={draft.alcoholDays === 0 ? 0 : (draft.alcoholWeek ?? "")}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      alcoholWeek: e.target.value === "" ? null : e.target.valueAsNumber,
                    })
                  }
                />
                <span>잔/주</span>
              </div>
            </label>
            <div className="health-option-row">
              <span id="binge-label">월 1회 이상 폭음 여부</span>
              <div className="health-options" role="radiogroup" aria-labelledby="binge-label">
                {([false, true, null] as const).map((value) => (
                  <label key={String(value)}>
                    <input
                      type="radio"
                      name="bingeMonthly"
                      disabled={draft.alcoholDays === 0}
                      checked={(draft.alcoholDays === 0 ? false : draft.bingeMonthly) === value}
                      onChange={() => setDraft({ ...draft, bingeMonthly: value })}
                    />
                    <span>{value === null ? "모름" : value ? "있음" : "없음"}</span>
                  </label>
                ))}
              </div>
            </div>
            <p className="profile-section-note">
              모델 기준: 한 번에 남성 7잔·여성 5잔 이상을 월 1회 이상 마신 경우예요. 음주 일수가
              0이면 마신 양과 폭음은 ‘없음’으로 반영해요.
            </p>
          </fieldset>
        )}
        {step === 8 && (
          <fieldset className="profile-section">
            <legend>추가 분석 정보</legend>
            <p className="profile-section-note">
              생활습관 참고 분석에 쓰이는 선택 정보예요. 실제 아는 값만 입력하고 모르면 비워 주세요.
            </p>
            <div className="profile-grid survey-lifestyle">
              <label>
                허리둘레
                <div className="health-input">
                  <input
                    aria-label="허리둘레"
                    type="number"
                    inputMode="decimal"
                    min={Number((50 / 2.54).toFixed(2))}
                    max={Number((150 / 2.54).toFixed(2))}
                    step="any"
                    placeholder="모름"
                    value={waistInches}
                    onChange={(event) => {
                      setWaistInches(event.target.value);
                      setDraft({
                        ...draft,
                        waistCm:
                          event.target.value === ""
                            ? null
                            : Number((event.target.valueAsNumber * 2.54).toFixed(4)),
                      });
                    }}
                  />
                  <span>인치</span>
                </div>
              </label>
              {(
                [
                  {
                    key: "restingHeartRate",
                    label: "안정 시 맥박",
                    unit: "회/분",
                    min: 1,
                    max: 300,
                    step: "1",
                  },
                  {
                    key: "educationYears",
                    label: "교육 이수 연수",
                    unit: "년",
                    min: 0,
                    max: 40,
                    step: "1",
                  },
                ] as const
              ).map(({ key, label, unit, min, max, step }) => (
                <label key={key}>
                  {label}
                  <div className="health-input">
                    <input
                      aria-label={label}
                      type="number"
                      inputMode="decimal"
                      min={min}
                      max={max}
                      step={step}
                      placeholder="모름"
                      value={draft[key] ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [key]: e.target.value === "" ? null : e.target.valueAsNumber,
                        })
                      }
                    />
                    <span>{unit}</span>
                  </div>
                </label>
              ))}
            </div>
            <p className="profile-section-note">
              교육 이수 연수는 학교 교육을 마친 총 연수예요. 임의의 평균값으로 채우지 않아요.
            </p>
          </fieldset>
        )}
        {lastPage && (
          <fieldset className="profile-section survey-confirmation">
            <legend>입력한 정보를 확인해 주세요</legend>
            <dl>
              <div>
                <dt>이름</dt>
                <dd>{draft.name}</dd>
              </div>
              {basicFlow ? (
                <>
                  <div>
                    <dt>혈압</dt>
                    <dd>{draft.bloodPressure ?? "모름"}</dd>
                  </div>
                  <div>
                    <dt>고혈압 진단·치료 상태</dt>
                    <dd>
                      {
                        {
                          unknown: "모름",
                          none: "진단 없음",
                          diagnosed_untreated: "진단받았으나 약 복용 안 함",
                          on_medication: "약 복용 중",
                        }[draft.htnStatus]
                      }
                    </dd>
                  </div>
                </>
              ) : questId === "lifestyle" ? (
                <>
                  <div>
                    <dt>흡연 여부</dt>
                    <dd>{draft.smoking === null ? "모름" : draft.smoking ? "예" : "아니요"}</dd>
                  </div>
                  <div>
                    <dt>주간 활동 시간</dt>
                    <dd>
                      {draft.activeMinutesWeek === null ? "모름" : draft.activeMinutesWeek + "분"}
                    </dd>
                  </div>
                  <div>
                    <dt>수면 시간</dt>
                    <dd>{draft.sleepHours === null ? "모름" : draft.sleepHours + "시간"}</dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>선택한 질환</dt>
                    <dd>
                      {draft.conditions.length
                        ? draft.conditions.length + "개"
                        : draft.conditionStatus === "none"
                          ? "없음"
                          : "모름"}
                    </dd>
                  </div>
                  <div>
                    <dt>등록한 약</dt>
                    <dd>{medications.length}개</dd>
                  </div>
                </>
              )}
            </dl>
            <p className="profile-section-note">
              {basicFlow
                ? "지병과 생활습관 기록은 첫 로그인부터 7일 안에 별도 퀘스트로 완료하면 경험치를 받아요."
                : "이전 버튼으로 내용을 수정할 수 있어요. 실제로 아는 정보만 기록해 주세요."}
            </p>
          </fieldset>
        )}
        {error && (
          <p className="survey-error" role="alert">
            {error}
          </p>
        )}
        {cloudEnabled && lastPage && (
          <label className="privacy-note">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              건강 프로필·복약·걸음 수·퀘스트 기록을 AWS 수집 API를 거쳐 Supabase(서울)에 저장하고,
              생활습관·신체 정보로 참고 분석을 제공하는 데 동의합니다. 민감한 기록은 내 계정에서만
              조회할 수 있어요.
            </span>
          </label>
        )}
        <div className="survey-actions">
          {step > 0 && (
            <button
              type="button"
              className="secondary-button"
              disabled={editingMedication}
              onClick={() => {
                setError("");
                setPageIndex(pageIndex - 1);
              }}
            >
              이전
            </button>
          )}
          <button
            type="submit"
            className="primary-button profile-submit"
            disabled={editingMedication}
          >
            {!lastPage
              ? `다음: ${basicFlow && flow[pageIndex + 1] === 1 ? "혈압 정보" : pages[flow[pageIndex + 1]].title}`
              : questId
                ? "퀘스트 기록 완료"
                : editing
                  ? "변경 저장하고 홈으로"
                  : "공룡 깨우기"}
          </button>
        </div>
        {lastPage && (
          <p className="privacy-note">
            <img src={assets.profile.imgHealthFormPrivacyIcon} alt="" />
            <span>
              {cloudEnabled
                ? "동의한 기록은 계정에 연결해 서버와 동기화해요."
                : "프로필은 이 세션에서 사용해요."}
              <br />
              {cloudEnabled
                ? "로그아웃하면 게임과 기기의 복약 알림을 중지해요. 서버에 저장된 기록은 다음 로그인 때 불러와요."
                : "약 이름·용량·시간과 복용 기록은 이 기기에 저장돼요. 로그아웃 시 삭제돼요."}
            </span>
          </p>
        )}
      </form>
    </ScenarioShell>
  );
}
