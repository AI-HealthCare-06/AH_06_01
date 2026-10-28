import { PixelSelect } from "../components/PixelSelect";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell, PageHeading } from "../components/AppShell";
import { useMotionCapture } from "../features/motion-capture/useMotionCapture";
import { injectionPoint } from "../features/motion-capture/injection";

const phaseLabels = {
  hand: "약을 준비한 손 → 입 → 손 내림",
  drink: "컵 접근 → 입 근처 유지 → 컵 내림",
  injection: "지정 부위에 손 접근 → 머묾 → 손 떼기",
  complete: "과정 동작 감지",
};
export function CvProcessPage() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"water" | "medicine" | "injection">(
    params.get("task") === "injection"
      ? "injection"
      : params.get("task") === "medicine"
        ? "medicine"
        : "water",
  );
  const quest = mode === "water" ? "water" : "medicine";
  const [prepared, setPrepared] = useState(false);
  const [toolType, setToolType] = useState("insulin_pen");
  const [label, setLabel] = useState("unlabelled");
  const {
    phase,
    source,
    progress,
    observation,
    result,
    latencyMs,
    message,
    start,
    cancel,
    bindVideo,
    selectedRegion,
    selectRegion,
  } = useMotionCapture(mode === "injection" ? "injection" : "process");
  const busy = ["loading", "observing"].includes(phase);
  const process = progress.process;
  const width = observation?.frameWidth || 360,
    height = observation?.frameHeight || 480;
  const camera = source === "camera" && busy;
  function exportResult() {
    if (!result) return;
    const exportData = {
      ...result,
      attemptedAction: label,
      purpose: "cv-process-development",
      videoSaved: false,
      targetProcess: mode,
      ...(mode === "injection"
        ? {
            userDeclaredTool: toolType,
            toolDetected: false,
            needleInsertionVerified: false,
            doseVerified: false,
          }
        : {}),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `rexrun-cv-${mode}-${source}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <AppShell active="camera">
      <Link className="quest-auth-back" to="/home">
        ← 홈
      </Link>
      <PageHeading title="FRONT CAMERA CV" subtitle="물 마시기·경구 복약·주사 동작 인식 테스트" />
      <section
        className="cv-process cream-card"
        data-phase={phase}
        aria-label="전면 카메라 과정 인식"
      >
        <div className="cv-mode-tabs" role="group" aria-label="인식할 과정">
          {(["water", "medicine", "injection"] as const).map((task) => (
            <button
              key={task}
              type="button"
              disabled={busy}
              aria-pressed={mode === task}
              onClick={() => {
                cancel();
                setMode(task);
                setPrepared(false);
                setLabel("unlabelled");
              }}
            >
              {task === "water" ? "물 마시기" : task === "medicine" ? "경구 복약" : "주사·인슐린"}
            </button>
          ))}
        </div>
        <p>
          {mode === "injection"
            ? "스마트폰을 고정하고 관찰할 투약 부위와 도구를 잡은 손을 담아 주세요. 카메라 시작 후 영상에서 부위를 터치해 지정합니다. 얼굴은 필요하지 않습니다."
            : "스마트폰을 눈높이에 세우고 얼굴·손·컵이 함께 보이게 해 주세요. 카메라 원본 화각 전체를 사용합니다."}
        </p>
        {mode === "injection" && (
          <label className="cv-tool-type">
            사용한 도구 (직접 선택)
            <PixelSelect
              aria-label="사용한 투약 도구"
              value={toolType}
              disabled={busy}
              onValueChange={(value) => setToolType(value)}
            >
              <option value="insulin_pen">인슐린 펜</option>
              <option value="syringe">일반 주사기</option>
            </PixelSelect>
          </label>
        )}
        {mode !== "water" && (
          <label className="cv-preparation">
            <input
              type="checkbox"
              checked={prepared}
              disabled={busy}
              onChange={(event) => setPrepared(event.target.checked)}
            />{" "}
            {mode === "injection"
              ? "처방받은 투약 방법을 따르며, 동작 테스트를 위해 추가 투약하지 않습니다."
              : "물과 함께 먹는 알약·캡슐의 경구 복약 과정입니다."}
          </label>
        )}
        <div
          className="cv-preview"
          data-source={source || "none"}
          onPointerDown={(event) => {
            if (mode !== "injection" || !camera) return;
            const element = event.currentTarget.querySelector("video");
            if (!element) return;
            const region = injectionPoint(
              event.clientX,
              event.clientY,
              element.getBoundingClientRect(),
              element.videoWidth,
              element.videoHeight,
            );
            if (region) selectRegion(region);
          }}
        >
          <video
            ref={bindVideo}
            muted
            autoPlay
            playsInline
            hidden={!camera}
            aria-label="전면 카메라 전체 화각"
          />
          {!camera && (
            <span className="cv-preview-placeholder">
              {source === "sample"
                ? "합성 좌표 시연"
                : mode === "injection"
                  ? "투약 부위 · 손"
                  : "얼굴 · 손 · 컵"}
            </span>
          )}
          {observation && (
            <svg
              className="cv-landmarks"
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
            >
              {mode === "injection" && selectedRegion && (
                <circle
                  cx={selectedRegion.x * width}
                  cy={selectedRegion.y * height}
                  r={selectedRegion.radius * Math.min(width, height)}
                  fill="none"
                  stroke="#e9cf66"
                  strokeWidth={4}
                />
              )}
              {observation.mouth && (
                <circle
                  cx={observation.mouth.x * width}
                  cy={observation.mouth.y * height}
                  r={8}
                  fill="#e9cf66"
                />
              )}
              {observation.hand && (
                <circle
                  cx={observation.hand.x * width}
                  cy={observation.hand.y * height}
                  r={10}
                  fill="#e5483c"
                />
              )}
              {observation.object && (
                <rect
                  x={observation.object.x * width}
                  y={observation.object.y * height}
                  width={observation.object.width * width}
                  height={observation.object.height * height}
                  fill="none"
                  stroke="#9ac47a"
                  strokeWidth={4}
                />
              )}
            </svg>
          )}
          <span className="cv-source-badge">
            {source === "sample" ? "SYNTHETIC" : camera ? "FRONT · LOCAL" : "READY"}
          </span>
        </div>
        {mode === "injection" && camera && (
          <button type="button" onClick={() => selectRegion({ x: 0.5, y: 0.5, radius: 0.12 })}>
            화면 중앙을 관찰 부위로 선택
          </button>
        )}
        <p className="cv-live-message" role="status">
          {message}
        </p>
        <div className="cv-process-steps" aria-label="인식 진행 단계">
          {(mode === "injection"
            ? (["injection"] as const)
            : quest === "medicine"
              ? (["hand", "drink"] as const)
              : (["drink"] as const)
          ).map((step, index) => (
            <div
              key={step}
              data-complete={
                process?.completedSteps.includes(step === "injection" ? "site_hand" : step) || false
              }
              data-current={process?.phase === step || false}
            >
              <b>0{index + 1}</b>
              <span>{phaseLabels[step]}</span>
            </div>
          ))}
        </div>
        <progress aria-label="현재 단계 유지 시간" max={1} value={progress.holdProgress} />
        <div className="cv-controls">
          <button
            className="primary-button"
            disabled={busy || (quest === "medicine" && !prepared)}
            onClick={() => void start(quest, "camera", prepared)}
          >
            전면 카메라 시작
          </button>
          <button
            disabled={busy || (quest === "medicine" && !prepared)}
            onClick={() => void start(quest, "sample", prepared)}
          >
            합성 시연
          </button>
          {busy && <button onClick={cancel}>인식 중단</button>}
        </div>
        <p className="cv-scope-note">
          {mode === "injection"
            ? "지정 부위 근처의 손 동작만 관찰합니다. 펜·주사기 식별, 바늘 삽입, 실제 약물 주입·용량은 판별하지 않습니다. 관찰 시간은 주사 유지 시간 안내가 아닙니다. 촬영 중 스마트폰이나 몸을 움직였다면 부위를 다시 지정해 주세요. 바늘 없는 연습으로 테스트할 수 있습니다."
            : "컵·병과 손의 동작 순서를 확인합니다. 알약·액체의 종류, 실제 삼킴이나 섭취량은 판별하지 않습니다. 이미 복용한 약을 테스트 때문에 다시 복용하지 마세요. 빈손·빈컵으로 연습할 수 있습니다."}
        </p>
        <p className="cv-scope-note">
          영상·음성은 저장하거나 서버로 보내지 않습니다. 이 실험 결과로 복약 기록이나 퀘스트 보상을
          생성하지 않습니다.
        </p>
        {result && (
          <section className="cv-result" aria-label="과정 인식 결과">
            <h3>{result.decision === "detected" ? "과정 동작 감지" : "과정 확인 불충분"}</h3>
            <p>
              {source === "sample"
                ? "합성 입력 · 실제 카메라 검증 결과가 아닙니다."
                : "실제 카메라 입력 · 동작 규칙 기반 결과"}
            </p>
            <label>
              시도한 동작 라벨
              <PixelSelect value={label} onValueChange={(value) => setLabel(value)}>
                <option value="unlabelled">미지정</option>
                <option value="drinking">컵으로 마시는 동작</option>
                <option value="oral_sequence">경구 복약 순서 동작</option>
                <option value="injection_site_sequence">투약 부위에 손 접근·머묾·떼기</option>
                <option value="face_touch">얼굴 만지기</option>
                <option value="cup_hold">컵 들고 있기</option>
                <option value="hand_only">손→입만 수행</option>
                <option value="no_action">동작 없음</option>
              </PixelSelect>
            </label>
            <button onClick={exportResult}>결과 JSON 저장</button>
          </section>
        )}
        <details className="cv-diagnostics">
          <summary>인식 상태 자세히 보기</summary>
          <dl>
            <div>
              <dt>처리 지연</dt>
              <dd>{latencyMs === null ? "—" : `${latencyMs}ms`}</dd>
            </div>
            <div>
              <dt>유효 관찰 비율</dt>
              <dd>{Math.round(progress.validObservationRatio * 100)}%</dd>
            </div>
            <div>
              <dt>단계</dt>
              <dd>
                {process?.phase ? phaseLabels[process.phase] : "준비"} · {progress.stage}
              </dd>
            </div>
          </dl>
          <small>유효 관찰 비율은 복용 정확도나 확률이 아닙니다.</small>
          <ol>
            {process?.trace.map((event, index) => (
              <li key={index}>
                {event.event} · {Math.round(event.timestamp - (process.trace[0]?.timestamp || 0))}ms
              </li>
            ))}
          </ol>
        </details>
      </section>
    </AppShell>
  );
}
