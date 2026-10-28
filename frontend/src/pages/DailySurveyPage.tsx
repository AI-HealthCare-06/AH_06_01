import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useGameStore } from "../stores/game-store";
import { useCloudStore } from "../cloud/sync";
import { cloudEnabled } from "../cloud/client";
import { PixelTimePicker } from "../components/PixelTimePicker";
import { SurveyChoices, SurveyHelp } from "../components/SurveyControls";
import { dailySurveySchema, sleepHoursFromTimes } from "../domain/daily-survey";
import { localDate } from "../domain/calendar";

const steps = [
  {
    title: "혈압",
    keys: ["bloodPressureStatus", "morning", "evening"],
    error:
      "혈압 측정 여부를 선택해 주세요. 측정했다면 수축기·이완기를 함께 입력하고 수축기가 더 큰지 확인해 주세요.",
  },
  {
    title: "안정 시 맥박",
    keys: ["pulseStatus", "restingHr"],
    error: "맥박 측정 여부와 입력값을 확인해 주세요.",
  },
  {
    title: "어젯밤 수면",
    keys: ["sleepStatus", "sleepHours", "bedtime", "wakeTime"],
    error: "수면 시간 확인 여부와 입력값을 확인해 주세요.",
  },
  { title: "공복 혈당", keys: ["fastingGlucose"], error: "공복 혈당 입력값을 확인해 주세요." },
  {
    title: "활동 시간",
    keys: ["activeMinutes"],
    error: "활동 시간은 0~1,440 사이의 정수로 입력해 주세요.",
  },
  {
    title: "앉아 있던 시간",
    keys: ["sedentaryHours"],
    error: "앉아 있던 시간은 0~24 사이로 입력해 주세요.",
  },
  { title: "코골이", keys: ["snoringScore", "snoring"], error: "코골이 응답을 확인해 주세요." },
  {
    title: "낮의 졸림",
    keys: ["daytimeSleepinessScore", "daytimeSleepiness"],
    error: "낮의 졸림 응답을 확인해 주세요.",
  },
  { title: "밤중 화장실", keys: ["nocturia"], error: "밤중 화장실 응답을 확인해 주세요." },
  { title: "입력 내용 확인", keys: [], error: "입력값을 다시 확인해 주세요." },
];

export function DailySurveyDialog({ onClose }: { onClose: () => void }) {
  const date = useGameStore((s) => s.game.date);
  const owner = useCloudStore((s) => s.userId);
  return <DailySurveyForm key={`${date}:${owner ?? "local"}`} date={date} onClose={onClose} />;
}
function DailySurveyForm({ date, onClose }: { date: string; onClose: () => void }) {
  const saved = useGameStore((s) => s.game.dailySurveys[date]);
  const cloud = useCloudStore();
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const current = steps[step];
  const review = step === steps.length - 1;
  const optional = step >= 3 && !review;
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    content.current?.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [step, message]);
  const [fields, setFields] = useState<Record<string, string>>(() => ({
    bloodPressureStatus: saved?.bloodPressureStatus ?? "",
    morningSystolic: saved?.morning?.systolic?.toString() ?? "",
    morningDiastolic: saved?.morning?.diastolic?.toString() ?? "",
    eveningSystolic: saved?.evening?.systolic?.toString() ?? "",
    eveningDiastolic: saved?.evening?.diastolic?.toString() ?? "",
    pulseStatus: saved?.pulseStatus ?? "",
    restingHr: saved?.restingHr?.toString() ?? "",
    sleepStatus:
      saved?.sleepStatus === "reported" && saved.sleepHours === 0
        ? "not-slept"
        : (saved?.sleepStatus ?? ""),
    bedtime: saved?.bedtime ?? "",
    wakeTime: saved?.wakeTime ?? "",
    snoringScore: saved?.snoringScore?.toString() ?? "unknown",
    daytimeSleepinessScore: saved?.daytimeSleepinessScore?.toString() ?? "unknown",
    fastingGlucose: saved?.fastingGlucose?.toString() ?? "",
    activeMinutes: saved?.activeMinutes?.toString() ?? "",
    sedentaryHours: saved?.sedentaryHours?.toString() ?? "",
    ...Object.fromEntries(
      (["snoring", "daytimeSleepiness", "nocturia"] as const).map((k) => [
        k,
        saved?.[k] === true ? "yes" : saved?.[k] === false ? "no" : "unknown",
      ]),
    ),
  }));
  function change(name: string, value: string) {
    setFields((f) => ({ ...f, [name]: value }));
    setError("");
  }
  const number = (name: string) => (fields[name].trim() === "" ? null : Number(fields[name]));
  function numeric(
    name: string,
    label: string,
    unit: string,
    max: number,
    min = 0,
    disabled = false,
    integer = false,
  ) {
    return (
      <label className="daily-survey-field">
        <span className="survey-number-heading">
          <span>{label}</span>
          <small>{unit}</small>
        </span>
        <span>
          <input
            aria-label={label}
            type="number"
            inputMode={integer ? "numeric" : "decimal"}
            step={integer ? 1 : "any"}
            min={min}
            max={max}
            value={fields[name]}
            disabled={disabled}
            onChange={(e) => change(name, e.target.value)}
          />
        </span>
      </label>
    );
  }
  function status(name: string, label: string, reported: string, absent: string) {
    return (
      <SurveyChoices
        label={label}
        value={fields[name]}
        onChange={(value) => change(name, value)}
        choices={[
          { value: name === "sleepStatus" ? "reported" : "measured", label: reported },
          { value: name === "sleepStatus" ? "unknown" : "not-measured", label: absent },
          ...(name === "sleepStatus" ? [{ value: "not-slept", label: "잠을 자지 않았어요" }] : []),
        ]}
      />
    );
  }
  const score = (key: string) =>
    fields[key] === "unknown" || fields[key] === "" ? null : Number(fields[key]);
  const duration = sleepHoursFromTimes(fields.bedtime, fields.wakeTime);
  function parse(submittedAt: number, forStep = false) {
    const include = (key: string) => !forStep || current.keys.includes(key);
    const measured = fields.bloodPressureStatus === "measured";
    const pair = (prefix: string) =>
      !measured || (!fields[prefix + "Systolic"] && !fields[prefix + "Diastolic"])
        ? null
        : { systolic: number(prefix + "Systolic"), diastolic: number(prefix + "Diastolic") };
    return dailySurveySchema.safeParse({
      date,
      submittedAt,
      bloodPressureStatus: include("bloodPressureStatus")
        ? fields.bloodPressureStatus
        : "not-measured",
      morning: include("morning") ? pair("morning") : null,
      evening: include("evening") ? pair("evening") : null,
      pulseStatus: include("pulseStatus") ? fields.pulseStatus : "not-measured",
      restingHr:
        include("restingHr") && fields.pulseStatus === "measured" ? number("restingHr") : null,
      sleepStatus: include("sleepStatus")
        ? fields.sleepStatus === "not-slept"
          ? "reported"
          : fields.sleepStatus
        : "unknown",
      sleepInputKind: fields.sleepStatus === "not-slept" ? "duration" : "times",
      bedtime:
        include("bedtime") && fields.sleepStatus === "reported" ? fields.bedtime || null : null,
      wakeTime:
        include("wakeTime") && fields.sleepStatus === "reported" ? fields.wakeTime || null : null,
      snoringScore: include("snoringScore") ? score("snoringScore") : null,
      daytimeSleepinessScore: include("daytimeSleepinessScore")
        ? score("daytimeSleepinessScore")
        : null,
      sleepHours: include("sleepHours")
        ? fields.sleepStatus === "not-slept"
          ? 0
          : fields.sleepStatus === "reported"
            ? duration
            : null
        : null,
      fastingGlucose: include("fastingGlucose") ? number("fastingGlucose") : null,
      activeMinutes: include("activeMinutes") ? number("activeMinutes") : null,
      sedentaryHours: include("sedentaryHours") ? number("sedentaryHours") : null,
      ...Object.fromEntries(
        ["snoring", "daytimeSleepiness", "nocturia"].map((k) => [
          k,
          k === "nocturia"
            ? fields[k] === "yes"
              ? true
              : fields[k] === "no"
                ? false
                : null
            : include(k + "Score") && score(k + "Score") !== null
              ? score(k + "Score")! > 0
              : null,
        ]),
      ),
    });
  }
  function move(next: number) {
    setError("");
    setStep(next);
  }
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (date !== localDate()) {
      setError("날짜가 바뀌었어요. 오늘의 서베이를 다시 열어 주세요.");
      return;
    }
    // This timestamp is read only inside the submit event handler, never during render.
    // eslint-disable-next-line react-hooks/purity
    const result = parse(Date.now(), !review);
    if (!review) {
      if (
        !result.success &&
        result.error.issues.some((issue) => current.keys.includes(String(issue.path[0])))
      ) {
        setError(current.error);
        return;
      }
      move(step + 1);
      return;
    }
    if (!result.success) {
      const first = result.error.issues[0];
      const invalidStep = steps.findIndex((s) => s.keys.includes(String(first.path[0])));
      setStep(Math.max(0, invalidStep));
      setError(steps[Math.max(0, invalidStep)].error);
      return;
    }
    const priorSleepExp = useGameStore.getState().game.sleepExperience[date]?.experience ?? 0;
    if (!useGameStore.getState().recordSurvey(result.data)) {
      setError("저장하지 못했어요. 로그인과 오늘 날짜를 확인해 주세요.");
      return;
    }
    const sleepBonus =
      (useGameStore.getState().game.sleepExperience[date]?.experience ?? 0) - priorSleepExp;
    setMessage(
      (saved
        ? "오늘의 건강 기록을 수정했어요. 메인 퀘스트 보상은 중복 지급하지 않아요."
        : "오늘 서베이를 제출했어요. 메인 퀘스트 보상을 받았어요.") +
        (sleepBonus > 0 ? ` 수면 보너스 +${sleepBonus} EXP` : ""),
    );
  }
  const measured = fields.bloodPressureStatus === "measured";
  const summary = [
    [
      "혈압",
      measured
        ? [
            fields.morningSystolic && `아침 ${fields.morningSystolic} / ${fields.morningDiastolic}`,
            fields.eveningSystolic && `저녁 ${fields.eveningSystolic} / ${fields.eveningDiastolic}`,
          ]
            .filter(Boolean)
            .join(" · ") + " mmHg"
        : "미측정",
    ],
    ["안정 시 맥박", fields.pulseStatus === "measured" ? fields.restingHr + " 회/분" : "미측정"],
    [
      "어젯밤 수면",
      fields.sleepStatus === "not-slept"
        ? "수면 0시간"
        : fields.sleepStatus === "reported" && duration !== null
          ? `${fields.bedtime} → ${fields.wakeTime} · ${Number(duration.toFixed(2))} 시간`
          : "모름",
    ],
    ["공복 혈당", fields.fastingGlucose ? fields.fastingGlucose + " mg/dL" : "미입력"],
    ["활동 시간", fields.activeMinutes ? fields.activeMinutes + " 분" : "미입력"],
    ["앉아 있던 시간", fields.sedentaryHours ? fields.sedentaryHours + " 시간" : "미입력"],
    ...["snoring", "daytimeSleepiness", "nocturia"].map((k, i) => [
      steps[i + 6].title,
      k === "nocturia"
        ? fields[k] === "yes"
          ? "예"
          : fields[k] === "no"
            ? "아니요"
            : "모름"
        : score(k + "Score") === null
          ? "모름"
          : `${score(k + "Score")} / 10`,
    ]),
  ];
  return (
    <dialog
      ref={dialog}
      className="cream-card daily-survey-dialog"
      aria-labelledby={id + "-title"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="daily-survey-header">
        <div>
          <small>
            DAILY SURVEY · <time>{date}</time>
          </small>
          <h2 id={id + "-title"}>오늘의 건강 서베이</h2>
        </div>
        <button type="button" aria-label="서베이 닫기" onClick={onClose}>
          ×
        </button>
      </header>
      <form className="daily-survey" onSubmit={handleSubmit} noValidate>
        <div className="daily-survey-progress">
          <span>
            {message
              ? "기록 완료"
              : `${step + 1} / ${steps.length} · ${review ? "제출 전 확인" : optional ? "선택 입력" : "응답 필요 · 미측정 선택 가능"}`}
          </span>
          <progress
            aria-label="서베이 진행"
            max={steps.length}
            value={message ? steps.length : step + 1}
          />
        </div>
        <div className="daily-survey-content" ref={content}>
          <div className="survey-question-heading">
            <h3 ref={heading} tabIndex={-1}>
              {message ? "오늘 기록 완료" : current.title}
            </h3>
            {!message && (
              <SurveyHelp
                key={step}
                label={current.title}
                text={
                  [
                    "실제로 측정한 혈압만 입력해요. 수축기·이완기를 함께 입력하며 아침 또는 저녁 중 측정한 시간대만 남겨도 돼요. 수치의 정상 여부는 보상 조건이 아니에요.",
                    "편안히 쉬고 있을 때 측정한 맥박을 기록해요. 측정값이 없으면 미측정을 선택해요.",
                    "어젯밤 잠자리에 든 시각과 오늘 잠에서 깬 시각을 입력해요. 자정을 넘으면 다음 날 기상으로 계산해요. 기록 간격을 수면 시간으로 활용하며 실제 수면 단계 측정은 아니에요. 게임 보상은 기록 시간당 기본 20 EXP, 최대 기본 160 EXP예요.",
                    "공복에 측정한 혈당만 입력해요. 서베이를 위해 검사나 약 복용을 추가할 필요는 없어요. 측정하지 않았다면 건너뛰세요.",
                    "오늘 중강도로 활동한 분을 입력해요. 활동하지 않았다면 0, 모르면 비워 두세요. 7일 기록이 모두 있을 때 주간 활동량으로 합산해요.",
                    "오늘 앉아서 보낸 시간을 기록해요. 모르는 값은 건너뛸 수 있어요.",
                    "어젯밤 코골이의 정도를 0(없음)~10(매우 심함)으로 표시해요. 확인하지 못했다면 모름을 선택해요.",
                    "오늘 낮의 졸림 정도를 0(없음)~10(매우 심함)으로 표시해요. 확인하지 못했다면 모름을 선택해요.",
                    "밤에 소변을 보기 위해 잠에서 깼는지 기록해요. 확인하지 못했다면 모름을 선택해요.",
                    "제출한 기록을 날짜별로 저장하고 대시보드와 모델이 지원하는 분석에 사용해요. 같은 날 수정해도 이미 받은 보상은 중복 지급하지 않아요. 서버 분석에는 건강 정보 저장 동의가 필요해요.",
                  ][step]
                }
              />
            )}
          </div>
          {message ? (
            <>
              <p role="status">{message}</p>
              <p>오늘 기록을 대시보드에서 확인할 수 있어요.</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setMessage("");
                  move(0);
                }}
              >
                입력값 수정
              </button>
            </>
          ) : (
            <>
              {step === 0 && (
                <>
                  {status(
                    "bloodPressureStatus",
                    "오늘 혈압 측정 여부",
                    "측정했어요",
                    "측정하지 못했어요",
                  )}
                  {measured && (
                    <div className="daily-survey-grid">
                      {numeric("morningSystolic", "아침 수축기", "mmHg", 999, 10, false, true)}
                      {numeric("morningDiastolic", "아침 이완기", "mmHg", 999, 10, false, true)}
                      {numeric("eveningSystolic", "저녁 수축기", "mmHg", 999, 10, false, true)}
                      {numeric("eveningDiastolic", "저녁 이완기", "mmHg", 999, 10, false, true)}
                    </div>
                  )}
                </>
              )}
              {step === 1 && (
                <>
                  {status(
                    "pulseStatus",
                    "안정 시 맥박 측정 여부",
                    "측정했어요",
                    "측정하지 못했어요",
                  )}
                  {fields.pulseStatus === "measured" &&
                    numeric("restingHr", "안정 시 맥박", "회/분", 250, 20, false, true)}
                </>
              )}
              {step === 2 && (
                <>
                  {status(
                    "sleepStatus",
                    "어젯밤 수면 시간 확인 여부",
                    "시간을 확인했어요",
                    "모르겠어요",
                  )}
                  {fields.sleepStatus === "reported" && (
                    <>
                      <div className="daily-survey-grid">
                        <label className="daily-survey-field">
                          취침 시각
                          <PixelTimePicker
                            label="취침 시각"
                            value={fields.bedtime}
                            context="survey"
                            onChange={(value) => change("bedtime", value)}
                          />
                        </label>
                        <label className="daily-survey-field">
                          기상 시각
                          <PixelTimePicker
                            label="기상 시각"
                            value={fields.wakeTime}
                            context="survey"
                            onChange={(value) => change("wakeTime", value)}
                          />
                        </label>
                      </div>
                      <output className="sleep-duration-output">
                        {duration === null
                          ? "취침·기상 시각을 선택해 주세요"
                          : `기록된 수면 ${Math.floor(duration)}시간 ${Math.round((duration % 1) * 60)}분`}
                      </output>
                    </>
                  )}
                </>
              )}
              {step === 3 && <>{numeric("fastingGlucose", "공복 혈당", "mg/dL", 1000, 20)}</>}
              {step === 4 && (
                <>{numeric("activeMinutes", "오늘 중강도 활동 시간", "분", 1440, 0, false, true)}</>
              )}
              {step === 5 && <>{numeric("sedentaryHours", "오늘 앉아 있던 시간", "시간", 24)}</>}
              {step >= 6 && step <= 7 && (
                <SurveyChoices
                  label={step === 6 ? "어젯밤 코골이 정도" : "오늘 낮의 졸림 정도"}
                  value={fields[step === 6 ? "snoringScore" : "daytimeSleepinessScore"]}
                  onChange={(value) =>
                    change(step === 6 ? "snoringScore" : "daytimeSleepinessScore", value)
                  }
                  scale
                  choices={[
                    ...Array.from({ length: 11 }, (_, i) => ({
                      value: String(i),
                      label: String(i),
                    })),
                    { value: "unknown", label: "모름 · 확인하지 못함" },
                  ]}
                />
              )}
              {step === 8 && (
                <SurveyChoices
                  label="밤에 소변 때문에 잠에서 깼나요?"
                  value={fields.nocturia}
                  onChange={(value) => change("nocturia", value)}
                  choices={[
                    { value: "yes", label: "예" },
                    { value: "no", label: "아니요" },
                    { value: "unknown", label: "모름 · 확인하지 못함" },
                  ]}
                />
              )}
              {review && (
                <>
                  <dl className="daily-survey-review">
                    {summary.map(([label, value], index) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                        <button
                          type="button"
                          aria-label={label + " 수정"}
                          onClick={() => move(index)}
                        >
                          수정
                        </button>
                      </div>
                    ))}
                  </dl>
                  {cloudEnabled && (
                    <small>
                      {cloud.consent
                        ? "계정 저장 동의가 켜져 있어요. 제출 후 서버에 동기화해요."
                        : "현재 기기에 기록해요. 서버 분석에는 마이페이지의 건강 정보 저장 동의가 필요해요."}
                    </small>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <footer className="daily-survey-footer">
          {error && <p role="alert">{error}</p>}
          {message ? (
            <>
              <Link className="primary-button" replace to={`/dashboard?period=day&date=${date}`}>
                대시보드에서 오늘 기록 보기 ›
              </Link>
              <button className="secondary-button" type="button" onClick={onClose}>
                닫기
              </button>
            </>
          ) : (
            <>
              <div className="daily-survey-actions">
                {step > 0 && (
                  <button className="secondary-button" type="button" onClick={() => move(step - 1)}>
                    이전
                  </button>
                )}
                <button className="primary-button" type="submit">
                  {review ? (saved ? "오늘 기록 수정" : "오늘 서베이 제출") : "다음"}
                </button>
              </div>
              {optional ? (
                <button
                  className="daily-survey-skip"
                  type="button"
                  onClick={() => {
                    const cleared = Object.fromEntries(
                      current.keys.map((k) => [k, step >= 6 ? "unknown" : ""]),
                    );
                    setFields((f) => ({ ...f, ...cleared }));
                    move(step + 1);
                  }}
                >
                  이 항목 건너뛰기
                </button>
              ) : (
                <small>마지막에 제출하기 전까지 기록은 저장되지 않아요.</small>
              )}
            </>
          )}
        </footer>
      </form>
    </dialog>
  );
}
