import { useEffect, useRef, useState } from "react";
import { InfoDialog } from "./InfoDialog";
import { useGameStore } from "../stores/game-store";
import { useProfileStore } from "../stores/profile-store";
import { useCloudStore } from "../cloud/sync";
import { useNotice } from "./NoticeProvider";
import {
  coachContext,
  coachContextKey,
  coachSurveySchema,
  eligibleExercises,
  exerciseCatalog,
  ruleCoachPlan,
  type CoachSurvey,
} from "../domain/exercise-coach";
import { requestExercisePlan } from "../services/exercise-coach";
import { demoMode } from "../domain/demo-mode";

const options = {
  motivation: [
    ["fun", "재미와 보상이 있어야 해요"],
    ["routine", "정해진 루틴이 좋아요"],
    ["social", "누군가와 함께하고 싶어요"],
  ],
  context: [
    ["ott", "드라마·동영상 보는 시간"],
    ["desk", "책상에서 일하는 시간"],
    ["outdoors", "밖에서 쉬는 시간"],
  ],
  activity: [
    ["inactive", "운동을 거의 하지 않아요"],
    ["occasional", "가끔 가볍게 움직여요"],
    ["regular", "규칙적으로 운동해요"],
  ],
  period: [
    ["morning", "아침"],
    ["lunch", "점심"],
    ["evening", "저녁"],
  ],
} as const;
function CoachSurveyDialog({ onClose }: { onClose: () => void }) {
  const existing = useGameStore((s) => s.game.exerciseCoach.survey);
  const [page, setPage] = useState(0),
    [message, setMessage] = useState("");
  const [draft, setDraft] = useState<Partial<CoachSurvey>>(
    existing ?? { limits: [], clinicianCleared: false },
  );
  const patch = (value: Partial<CoachSurvey>) => setDraft((d) => ({ ...d, ...value }));
  const notice = useNotice();
  const radio = (key: keyof typeof options, title: string) => (
    <fieldset>
      <legend>{title}</legend>
      {options[key].map(([value, label]) => (
        <label key={value}>
          <input
            type="radio"
            name={key}
            checked={draft[key] === value}
            onChange={() => patch({ [key]: value })}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
  const valid =
    page === 0
      ? !!draft.motivation && !!draft.context
      : page === 1
        ? !!draft.minutes && !!draft.activity && !!draft.period
        : page === 2
          ? draft.alcoholDays !== undefined && draft.binge !== undefined
          : true;
  function submit() {
    const result = coachSurveySchema.safeParse({ ...draft, updatedAt: Date.now() });
    if (!result.success) {
      setMessage("답하지 않은 항목을 확인해 주세요.");
      return;
    }
    if (!useGameStore.getState().saveCoachSurvey(result.data)) {
      setMessage("저장 공간과 로그인 상태를 확인해 주세요.");
      return;
    }
    notice(
      existing
        ? "운동 취향을 수정했어요. 오늘의 추천을 다시 받아 주세요."
        : "운동 취향 서베이 완료 · +100 EXP",
    );
    onClose();
  }
  return (
    <InfoDialog title="나의 운동 취향 서베이" onClose={onClose} confirmLabel="나중에">
      <div className="coach-survey" data-no-swipe>
        <p>{page + 1} / 5 · 나를 알아가는 작은 시작</p>
        <progress aria-label="운동 취향 설문 진행" max={5} value={page + 1} />
        {page === 0 && (
          <>
            {radio("motivation", "꾸준히 하려면 무엇이 필요할까요?")}
            {radio("context", "어떤 일상에 움직임을 더할까요?")}
          </>
        )}
        {page === 1 && (
          <>
            <fieldset>
              <legend>한 번에 부담 없는 시간</legend>
              <div className="coach-scale">
                {([2, 5, 10, 15] as const).map((n) => (
                  <label key={n}>
                    <input
                      type="radio"
                      name="minutes"
                      checked={draft.minutes === n}
                      onChange={() => patch({ minutes: n })}
                    />
                    {n}분
                  </label>
                ))}
              </div>
            </fieldset>
            {radio("activity", "현재 운동 습관")}
            {radio("period", "실천하기 좋은 시간")}
          </>
        )}
        {page === 2 && (
          <>
            <fieldset>
              <legend>일주일에 술을 마시는 날</legend>
              <div className="coach-scale">
                {Array.from({ length: 8 }, (_, n) => (
                  <label key={n}>
                    <input
                      type="radio"
                      name="alcoholDays"
                      checked={draft.alcoholDays === n}
                      onChange={() => patch({ alcoholDays: n })}
                    />
                    {n}일
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>가끔 계획보다 많이 마시나요?</legend>
              {([true, false] as const).map((value) => (
                <label key={String(value)}>
                  <input
                    type="radio"
                    name="binge"
                    checked={draft.binge === value}
                    onChange={() => patch({ binge: value })}
                  />
                  {value ? "그런 적 있어요" : "아니요"}
                </label>
              ))}
            </fieldset>
            <p>음주 직후 운동을 독려하지 않아요. 시작 전 오늘 상태를 확인해요.</p>
          </>
        )}
        {page === 3 && (
          <>
            <fieldset>
              <legend>움직임에 주의할 부분</legend>
              {(
                [
                  ["knee", "무릎 불편"],
                  ["back", "허리 불편"],
                  ["shoulder", "어깨 불편"],
                  ["doctor", "의료진이 운동을 제한했어요"],
                  ["pregnancy", "임신·산후 운동 상담이 필요해요"],
                ] as const
              ).map(([id, label]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={draft.limits?.includes(id)}
                    onChange={(e) =>
                      patch({
                        limits: e.target.checked
                          ? [...(draft.limits ?? []), id]
                          : draft.limits?.filter((v) => v !== id),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <label className="coach-confirm">
              <input
                type="checkbox"
                checked={draft.clinicianCleared === true}
                onChange={(e) => patch({ clinicianCleared: e.target.checked })}
              />
              지병이 있다면 의료진에게 가벼운 활동이 가능한지 확인했어요.
            </label>
            <small>확인 전에는 체크하지 않아도 돼요. 운동 대신 먼저 상담하도록 안내해요.</small>
          </>
        )}
        {page === 4 && (
          <>
            <p>취향·가능한 시간·운동 습관·음주 패턴·움직임의 제한을 추천에 반영해요.</p>
            <p>
              서베이는 계정 건강 정보 저장 동의 범위에서 저장돼요. 외부 AI 추천은 별도 동의 후
              요청해요.
            </p>
            <button className="primary-button" onClick={submit}>
              서베이 저장{existing ? "" : " · +100 EXP"}
            </button>
          </>
        )}
        {message && <p role="alert">{message}</p>}
        <div className="coach-page-actions">
          {page > 0 && <button onClick={() => setPage((p) => p - 1)}>이전</button>}
          {page < 4 && (
            <button
              className="primary-button"
              disabled={!valid}
              onClick={() => setPage((p) => p + 1)}
            >
              다음 항목
            </button>
          )}
        </div>
      </div>
    </InfoDialog>
  );
}

export function ExerciseCoachPanel() {
  const game = useGameStore((s) => s.game),
    profile = useProfileStore((s) => s.profile),
    owner = useCloudStore((s) => s.userId);
  const coach = game.exerciseCoach,
    survey = coach.survey;
  const [surveyOpen, setSurveyOpen] = useState(false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null),
    [running, setRunning] = useState(false),
    [seconds, setSeconds] = useState(0),
    [ready, setReady] = useState(false);
  const request = useRef<AbortController | null>(null),
    notice = useNotice();
  const context = coachContext(game, profile),
    contextKey = coachContextKey(context);
  const plan =
    coach.plan?.date === game.date &&
    coach.plan.surveyRevision === survey?.updatedAt &&
    coach.plan.contextKey === contextKey
      ? coach.plan
      : null;
  const safe = survey ? eligibleExercises(survey, context) : null;
  const exercise = exerciseCatalog.find((e) => e.id === selected);
  const dailyRewardLimit = (coach.completed[game.date]?.length ?? 0) >= 3;
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!running) return;
    const pauseWhenHidden = () => {
      if (document.visibilityState !== "visible") setRunning(false);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    let previous = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = (now - previous) / 1000;
      previous = now;
      if (document.visibilityState === "visible")
        setSeconds((s) => Math.min((exercise?.minutes ?? 2) * 60, s + elapsedSeconds));
    }, 250);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", pauseWhenHidden);
    };
  }, [running, exercise]);
  async function recommend() {
    if (!survey || !consent || busy) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 28_000);
    setBusy(true);
    setError("");
    try {
      const result = await requestExercisePlan(
        game.date,
        survey,
        context,
        owner,
        controller.signal,
      );
      if (
        useCloudStore.getState().userId !== owner ||
        !useGameStore.getState().saveCoachPlan(result)
      )
        throw new Error("기록이 변경됐어요. 다시 추천해 주세요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 연결을 확인해 주세요.");
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  }
  return (
    <section className="exercise-coach cream-card" aria-label="맞춤 운동 서브 퀘스트">
      <header>
        <div>
          <small>MOVE AT YOUR PACE</small>
          <h3>{survey ? "나에게 맞는 작은 움직임" : "운동 취향 알아보기"}</h3>
        </div>
        <span className="pixel-tag">Sub Quest</span>
      </header>
      <p>
        {survey
          ? "취향과 오늘의 기록에 맞춰, 부담 없는 시작부터."
          : "드라마 한 편 전 2분부터. 내 성향에 맞는 운동을 찾아요."}
      </p>
      <button className="coach-survey-button" onClick={() => setSurveyOpen(true)}>
        {survey ? "운동 취향 수정 ›" : "첫 운동 취향 서베이 · +100 EXP ›"}
      </button>
      {survey && (
        <>
          <p className="coach-safety">{safe?.message}</p>
          <label className="coach-confirm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            취향·운동/음주 습관과 운동 후보를 외부 OpenAI에 보내 AI 추천을 받아요. 이름·사진·혈압
            측정값은 보내지 않아요.
          </label>
          <div className="coach-page-actions">
            <button
              className="primary-button"
              disabled={
                !consent || busy || !safe?.items.length || (demoMode && import.meta.env.PROD)
              }
              onClick={() => void recommend()}
            >
              {busy ? "AI 분석 중…" : "AI 맞춤 추천 받기"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  !useGameStore.getState().saveCoachPlan(ruleCoachPlan(game.date, survey, context))
                )
                  setError("오늘 기록으로 다시 시도해 주세요.");
              }}
            >
              기본 추천 보기
            </button>
          </div>
          {demoMode && import.meta.env.PROD && <small>체험 계정에서는 기본 추천을 이용해요.</small>}
          {error && <p role="alert">{error}</p>}
          {plan && (
            <div className="coach-plan">
              <small>
                {plan.source === "ai" ? `AI 선택 · ${plan.model}` : "설문 기반 기본 추천"}
              </small>
              <p>{plan.summary}</p>
              {plan.items.map((item) => {
                const e = exerciseCatalog.find((v) => v.id === item.id)!,
                  done = coach.completed[game.date]?.includes(item.id);
                return (
                  <button
                    key={item.id}
                    className="coach-exercise-card"
                    onClick={() => {
                      setSelected(item.id);
                      setSeconds(0);
                      setRunning(false);
                      setReady(false);
                    }}
                  >
                    <strong>{e.title}</strong>
                    <span>
                      {e.minutes}분 ·{" "}
                      {done ? "오늘 완료" : dailyRewardLimit ? "오늘 보상 완료" : "+60 EXP"}
                    </span>
                    <small>{item.reason}</small>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {surveyOpen && <CoachSurveyDialog onClose={() => setSurveyOpen(false)} />}
      {exercise && (
        <InfoDialog
          title={exercise.title}
          onClose={() => {
            setSelected(null);
            setRunning(false);
          }}
          confirmLabel="닫기"
        >
          <ol>
            {exercise.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="coach-safety">{safe?.message}</p>
          <label className="coach-confirm">
            <input
              type="checkbox"
              checked={ready}
              disabled={running}
              onChange={(e) => setReady(e.target.checked)}
            />
            오늘 음주 직후가 아니며, 통증·어지럼·가슴 불편감이 없어요.
          </label>
          <div className="coach-timer" role="timer" aria-label="운동 남은 시간">
            {Math.floor(Math.max(0, exercise.minutes * 60 - seconds) / 60)}:
            {String(Math.floor(Math.max(0, exercise.minutes * 60 - seconds) % 60)).padStart(2, "0")}
          </div>
          <progress aria-label="운동 시간 진행" value={seconds} max={exercise.minutes * 60} />
          <small>앱 화면이 보이는 동안의 시간이에요. 시간만으로 실천을 인증하지 않아요.</small>
          {dailyRewardLimit && <p>오늘의 운동 보상 3개를 모두 받았어요.</p>}
          <button
            className="primary-button"
            disabled={!ready || !plan || !safe?.items.some((i) => i.id === exercise.id)}
            onClick={() => setRunning((v) => !v)}
          >
            {running ? "잠깐 쉬기" : "실천 타이머 시작"}
          </button>
          <button
            className="primary-button"
            disabled={
              seconds < exercise.minutes * 60 ||
              !ready ||
              !plan ||
              dailyRewardLimit ||
              coach.completed[game.date]?.includes(exercise.id)
            }
            onClick={() => {
              const reward = useGameStore.getState().finishExercise(exercise.id);
              if (reward !== null) {
                notice(`${exercise.title} 완료 · +${reward} EXP`);
                setSelected(null);
                setRunning(false);
              } else setError("현재 추천과 완료 기록을 확인해 주세요.");
            }}
          >
            직접 실천 완료 확인 · +60 EXP
          </button>
        </InfoDialog>
      )}
    </section>
  );
}
