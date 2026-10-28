import { PixelSelect } from "../components/PixelSelect";
import { MealAnalysisPanel } from "../components/MealAnalysisPanel";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell, PageHeading } from "../components/AppShell";
import { PixelIcon } from "../components/PixelIcon";
import { quests } from "../domain/game";
import { useMotionCapture } from "../features/motion-capture/useMotionCapture";
import type { InputSource, MotionQuest } from "../features/motion-capture/types";
import { useQuestVerificationStore } from "../stores/quest-verification-store";
import { useMedicationStore } from "../stores/medication-store";
import { dailyDoses } from "../domain/medications";
import { localDate } from "../domain/calendar";
import { validQuestProof } from "../domain/quest-verification";
const cameraQuests = quests.filter((q) => ["medicine", "meal", "water"].includes(q.id));
const facingFor = (quest: string) => (quest === "water" ? "user" : "environment");
const readyMessage = (selection: string) =>
  selection.endsWith(":sample")
    ? "화면을 터치해 샘플 동작을 시작해 주세요."
    : selection === "meal" || selection === "medicine"
      ? "화면을 터치해 카메라를 켜 주세요."
      : "화면을 터치해 모션 인식을 시작해 주세요.";

export type CameraQuest = "medicine" | "meal" | "water";

export function CameraPage() {
  return (
    <AppShell active="camera">
      <Link className="quest-auth-back" to="/home">
        ← 홈
      </Link>
      <PageHeading title="QUEST VERIFY" subtitle="사진·동작을 인증하고 퀘스트를 완료해요" />
      <QuestCamera />
    </AppShell>
  );
}

export function QuestCamera({ fixedQuest }: { fixedQuest?: CameraQuest }) {
  const [params] = useSearchParams();
  const [day, setDay] = useState(localDate);
  const [now, setNow] = useState(Date.now);
  const medicineProof = useQuestVerificationStore((s) => s.proofs.medicine);
  useEffect(() => {
    const refresh = () => {
      setDay(localDate());
      setNow(Date.now());
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const initialQuest =
    fixedQuest ??
    (cameraQuests.some((q) => q.id === params.get("quest")) ? params.get("quest")! : "meal");
  const [selection, setSelection] = useState(
    !fixedQuest && initialQuest !== "meal" && params.get("source") === "sample"
      ? `${initialQuest}:sample`
      : initialQuest,
  );
  const quest = selection.split(":")[0];
  const source: InputSource = selection.endsWith(":sample") ? "sample" : "camera";
  const photoQuest = source === "camera" && (quest === "meal" || quest === "medicine");
  const medicationState = useMedicationStore();
  const doses = dailyDoses(medicationState.medications, day, medicationState.taken).filter(
    (d) => !d.taken,
  );
  const [selectedDose, setSelectedDose] = useState(params.get("dose") || "");
  const targetDose = doses.some((dose) => dose.key === selectedDose)
    ? selectedDose
    : doses[0]?.key || "";
  const capturedAt = useRef(0);
  const capturedDose = useRef("");
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [photoRevision, setPhotoRevision] = useState(0);
  const [message, setMessage] = useState(() => readyMessage(selection));
  const [preparingMedicine, setPreparingMedicine] = useState(false);
  const {
    phase,
    source: motionSource,
    message: motionMessage,
    result,
    bindVideo,
    start: startMotion,
    cancel: cancelMotion,
    confirm: confirmMotion,
  } = useMotionCapture();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef(0);
  const bindCamera = useCallback(
    (element: HTMLVideoElement | null) => {
      video.current = element;
      bindVideo(element);
    },
    [bindVideo],
  );
  const cameraLive = live || (phase === "observing" && motionSource === "camera");
  const connecting = busy || phase === "loading";
  const sampleRunning = phase === "observing" && motionSource === "sample";
  const status = preparingMedicine
    ? "복용할 약을 준비했는지 확인해 주세요. 준비됐으면 화면을 다시 터치해 주세요. 인식을 위해 약을 반복해서 먹지 마세요."
    : phase !== "idle"
      ? motionMessage
      : message;
  const viewfinderAction = photo
    ? "촬영 사진 미리보기"
    : result
      ? "모션 인식 결과"
      : connecting
        ? "카메라 준비 취소"
        : cameraLive
          ? photoQuest
            ? "촬영하기"
            : "인식 종료"
          : sampleRunning
            ? "샘플 종료"
            : preparingMedicine
              ? "약 준비 확인하고 시작"
              : source === "sample"
                ? "샘플 동작 보기"
                : photoQuest
                  ? "카메라 켜기"
                  : "모션 인식 시작";

  function stop() {
    if (video.current && video.current.srcObject === stream.current) video.current.srcObject = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  useEffect(() => {
    const invalidate = () => {
      request.current++;
      stop();
    };
    const hide = () => {
      if (document.visibilityState === "hidden") {
        invalidate();
        setLive(false);
        setBusy(false);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      invalidate();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);

  async function startPhoto() {
    const token = ++request.current;
    stop();
    setLive(false);
    setBusy(true);
    setPhoto(null);
    setSaved(false);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error("카메라는 HTTPS 또는 localhost 환경에서 사용할 수 있어요.");
      const next = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 960 },
          height: { ideal: 1280 },
          aspectRatio: { ideal: 3 / 4 },
        },
        audio: false,
      });
      if (request.current !== token) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = next;
      next.getVideoTracks().forEach((track) =>
        track.addEventListener(
          "ended",
          () => {
            if (request.current !== token) return;
            request.current++;
            stop();
            setLive(false);
            setBusy(false);
            setPhoto(null);
            setMessage("카메라 연결이 끊어졌어요. 다시 연결한 뒤 촬영해 주세요.");
          },
          { once: true },
        ),
      );
      if (video.current) {
        video.current.srcObject = next;
        setLive(true);
        await video.current.play();
      }
      if (request.current !== token) return;
      setLive(true);
      setMessage(
        quest === "medicine"
          ? "복약·투약 후 사진을 촬영해 주세요. 인증을 위해 다시 복용·투약하지 마세요."
          : "음식을 세로 화면에 담고 화면을 터치해 촬영해 주세요.",
      );
    } catch (error) {
      if (request.current !== token) return;
      stop();
      setLive(false);
      setMessage(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "카메라 권한이 꺼져 있어요. 브라우저·앱 설정에서 허용한 뒤 다시 시도해 주세요."
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "사용할 수 있는 카메라를 찾지 못했어요."
            : error instanceof DOMException && error.name === "NotReadableError"
              ? "다른 앱에서 카메라를 사용 중이에요. 닫고 다시 시도해 주세요."
              : error instanceof Error
                ? error.message
                : "카메라를 켜지 못했어요. 다시 시도해 주세요.",
      );
    } finally {
      if (request.current === token) setBusy(false);
    }
  }
  function start(nextSelection = selection, preparation = false) {
    request.current++;
    stop();
    cancelMotion();
    setLive(false);
    setBusy(false);
    setPhoto(null);
    setSaved(false);
    const nextQuest = nextSelection.split(":")[0];
    if (
      nextQuest === "medicine" &&
      !nextSelection.endsWith(":sample") &&
      !doses.some((d) => d.key === targetDose)
    ) {
      setMessage("복약 일정을 먼저 등록하거나 인증할 시간을 선택해 주세요.");
      return;
    }
    if (nextQuest === "medicine" && nextSelection.endsWith(":sample") && !preparation) {
      setPreparingMedicine(true);
      return;
    }
    setPreparingMedicine(false);
    if (nextQuest === "meal" || (nextQuest === "medicine" && !nextSelection.endsWith(":sample")))
      void startPhoto();
    else
      void startMotion(
        nextQuest as MotionQuest,
        nextSelection.endsWith(":sample") ? "sample" : "camera",
        preparation,
      );
  }
  function capture() {
    if (!video.current?.videoWidth) return;
    if (
      photoQuest &&
      (!live || !stream.current?.getVideoTracks().some((track) => track.readyState === "live"))
    )
      return;
    const canvas = document.createElement("canvas");
    const source = video.current;
    const width = Math.min(source.videoWidth, (source.videoHeight * 3) / 4);
    const height = (width * 4) / 3;
    canvas.height = Math.min(1280, Math.round(height));
    canvas.width = Math.round((canvas.height * 3) / 4);
    const context = canvas.getContext("2d")!;
    if (facingFor(quest) === "user") {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(
      source,
      (source.videoWidth - width) / 2,
      (source.videoHeight - height) / 2,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    setPhoto(canvas.toDataURL("image/jpeg", 0.88));
    setPhotoRevision((value) => value + 1);
    capturedAt.current = Date.now();
    capturedDose.current = quest === "medicine" ? targetDose : "";
    cancelMotion();
    stop();
    setLive(false);
    setMessage("사진을 확인해 주세요.");
  }
  function activateViewfinder() {
    if (photo || result) return;
    if (connecting) {
      request.current++;
      stop();
      cancelMotion();
      setLive(false);
      setBusy(false);
      setPreparingMedicine(false);
      setMessage("카메라 연결을 취소했어요. 화면을 터치해 다시 시작해 주세요.");
    } else if (cameraLive) {
      if (photoQuest) capture();
      else {
        cancelMotion();
        setMessage("동작 인식을 종료했어요. 다시 시작할 수 있어요.");
      }
    } else if (sampleRunning) cancelMotion();
    else start(selection, preparingMedicine);
  }
  return (
    <section className="camera-card">
      {!fixedQuest && (
        <label className="camera-quest-select">
          기록할 퀘스트
          <PixelSelect
            value={selection}
            disabled={!!photo || connecting || !!result}
            onValueChange={(value) => {
              const next = value;
              setSelection(next);
              setPreparingMedicine(false);
              if (cameraLive || sampleRunning) start(next);
              else {
                cancelMotion();
                setMessage(readyMessage(next));
              }
            }}
          >
            {cameraQuests.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title}
              </option>
            ))}
            <option value="water:sample">물 마시기 · 샘플 시연</option>
            <option value="medicine:sample">약 복용 동작 · 샘플 시연</option>
          </PixelSelect>
        </label>
      )}
      {quest === "medicine" && source === "camera" && (
        <label className="camera-quest-select">
          인증할 복약·투약 시간
          <PixelSelect
            value={targetDose}
            disabled={!!photo || connecting || live}
            onValueChange={(value) => setSelectedDose(value)}
          >
            {!doses.length && <option value="">등록된 미완료 일정 없음</option>}
            {doses.map((d) => (
              <option key={d.key} value={d.key}>
                {d.time} · {d.medication.name}
              </option>
            ))}
          </PixelSelect>
        </label>
      )}
      <p className="camera-mode">
        {photoQuest
          ? quest === "medicine"
            ? "후면 카메라 · 복약·투약 사진 인증"
            : "후면 카메라 · 식사 사진 인증"
          : source === "sample"
            ? "샘플 시연 · 실제 카메라를 사용하지 않아요"
            : phase === "idle"
              ? "전면 카메라 · 실시간 인식 준비"
              : `전면 카메라 · ${quest === "water" ? "물 마시는" : "약 복용"} 동작 인식`}
      </p>
      <button
        type="button"
        className={`camera-viewfinder ${cameraLive ? "live" : ""}`}
        data-facing={facingFor(quest)}
        aria-label={viewfinderAction}
        aria-busy={connecting}
        disabled={!!photo || !!result}
        onClick={activateViewfinder}
      >
        <video
          ref={bindCamera}
          autoPlay
          playsInline
          muted
          hidden={!cameraLive}
          aria-label="실시간 카메라 화면"
        />
        {photo ? (
          <img src={photo} alt="촬영한 퀘스트 사진" />
        ) : (
          !cameraLive && (
            <span className="camera-placeholder">
              <PixelIcon name="camera" />
              <strong>READY TO CAPTURE</strong>
            </span>
          )
        )}
        <span className="viewfinder-corner" aria-hidden="true" />
      </button>
      <p className="camera-status" role="status">
        {status}
      </p>
      {(photo || result) && (
        <div className="camera-actions">
          <button onClick={() => start()}>{result ? "다시 인식" : "다시 촬영"}</button>
          <button
            disabled={result ? result.userConfirmed || result.decision !== "detected" : saved}
            onClick={() => {
              if (result) {
                confirmMotion();
                if (result.inputSource === "camera") {
                  const accepted = useQuestVerificationStore
                    .getState()
                    .motion({ ...result, userConfirmed: true });
                  setSaved(accepted);
                }
              } else {
                if (quest !== "meal" && quest !== "medicine") return;
                if (quest === "medicine" && !doses.some((d) => d.key === capturedDose.current)) {
                  setMessage("복약 일정이 바뀌었어요. 시간을 다시 선택하고 촬영해 주세요.");
                  return;
                }
                const accepted = useQuestVerificationStore
                  .getState()
                  .photo(quest, photo!, capturedAt.current, capturedDose.current || undefined);
                setSaved(accepted);
                setNow(Date.now());
                setMessage(
                  accepted
                    ? quest === "meal"
                      ? "사진 인증을 확인했어요. 식단 분석은 별도로 선택할 수 있어요. 아래에서 완료 기록으로 이동해 주세요."
                      : "사진 인증을 확인했어요. 사진은 업로드·저장하지 않아요. 아래에서 완료 기록으로 이동해 주세요."
                    : "사진 인증이 만료됐어요. 다시 촬영해 주세요.",
                );
              }
            }}
          >
            {saved || result?.userConfirmed
              ? "확인 완료"
              : result
                ? result.decision === "detected"
                  ? "동작 확인"
                  : "인식 미확정"
                : "이 사진 사용"}
          </button>
        </div>
      )}
      {quest === "meal" && photo && <MealAnalysisPanel key={photoRevision} photo={photo} />}
      {saved &&
        (quest === "medicine" ? (
          <button
            type="button"
            className="camera-proof-return"
            disabled={
              !validQuestProof(medicineProof, "medicine", now, targetDose) ||
              !doses.some((dose) => dose.key === targetDose)
            }
            onClick={() => {
              const dose = doses.find((dose) => dose.key === capturedDose.current);
              if (!dose || !medicationState.markTaken(dose.medication.id, dose.time)) {
                setMessage("인증과 복약 일정을 다시 확인해 주세요.");
                return;
              }
              setPhoto(null);
              setSaved(false);
              setSelectedDose("");
              setMessage("복용·투약 기록을 저장했어요.");
            }}
          >
            인증한 복약·투약 기록하기
          </button>
        ) : (
          <Link className="camera-proof-return" to={`/quests/${quest}`}>
            인증한 퀘스트 완료하기
          </Link>
        ))}
      {photoQuest && (
        <p className="camera-proof-note">
          {quest === "meal"
            ? "사진 인증만 이용하면 사진을 업로드·저장하지 않아요. 식단 분석은 별도 동의 후 OpenAI로 사진을 보내 음식명·예상 중량을 확인합니다."
            : "직접 촬영한 사진의 제출을 확인해요. 약의 종류나 실제 복용 사실을 AI로 판정하지 않아요."}
        </p>
      )}
      {quest === "water" && source === "camera" && (
        <p className="camera-proof-note">
          물 마시는 동작만 확인하며 실제 섭취량은 측정하지 않아요.
        </p>
      )}
      {quest === "medicine" && source === "camera" && !doses.length && (
        <Link to="/medications">복약 일정 등록하기 ›</Link>
      )}
    </section>
  );
}
