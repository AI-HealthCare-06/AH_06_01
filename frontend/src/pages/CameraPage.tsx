import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell, PageHeading } from "../components/AppShell";
import { PixelIcon } from "../components/PixelIcon";
import { quests } from "../domain/game";
import { useMotionCapture } from "../features/motion-capture/useMotionCapture";
import type { InputSource, MotionQuest } from "../features/motion-capture/types";
const cameraQuests = quests.filter((q) => ["medicine", "meal", "water"].includes(q.id));
const facingFor = (quest: string) => (quest === "meal" ? "environment" : "user");
const readyMessage = (selection: string) =>
  selection.endsWith(":sample")
    ? "화면을 터치해 샘플 동작을 시작해 주세요."
    : selection === "meal"
      ? "화면을 터치해 카메라를 켜 주세요."
      : "화면을 터치해 모션 인식을 시작해 주세요.";

export function CameraPage() {
  const [params] = useSearchParams();
  const initialQuest = cameraQuests.some((q) => q.id === params.get("quest"))
    ? params.get("quest")!
    : "meal";
  const [selection, setSelection] = useState(
    initialQuest !== "meal" && params.get("source") === "sample"
      ? `${initialQuest}:sample`
      : initialQuest,
  );
  const quest = selection.split(":")[0];
  const source: InputSource = selection.endsWith(":sample") ? "sample" : "camera";
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
          ? "촬영하기"
          : sampleRunning
            ? "샘플 종료"
            : preparingMedicine
              ? "약 준비 확인하고 시작"
              : source === "sample"
                ? "샘플 동작 보기"
                : quest === "meal"
                  ? "카메라 켜기"
                  : "모션 인식 시작";

  function stop() {
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
      if (video.current) {
        video.current.srcObject = next;
        await video.current.play();
      }
      if (request.current !== token) return;
      setLive(true);
      setMessage("음식을 세로 화면에 담고 화면을 터치해 촬영해 주세요.");
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
    if (nextQuest === "medicine" && !preparation) {
      setPreparingMedicine(true);
      return;
    }
    setPreparingMedicine(false);
    if (nextQuest === "meal") void startPhoto();
    else
      void startMotion(
        nextQuest as MotionQuest,
        nextSelection.endsWith(":sample") ? "sample" : "camera",
        preparation,
      );
  }
  function capture() {
    if (!video.current?.videoWidth) return;
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
    } else if (cameraLive) capture();
    else if (sampleRunning) cancelMotion();
    else start(selection, preparingMedicine);
  }
  return (
    <AppShell active="camera">
      <PageHeading title="QUEST CAMERA" subtitle="오늘의 건강한 순간을 한 장에 담아요" />
      <section className="camera-card">
        <label className="camera-quest-select">
          기록할 퀘스트
          <select
            value={selection}
            disabled={!!photo || connecting || !!result}
            onChange={(event) => {
              const next = event.target.value;
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
          </select>
        </label>
        <p className="camera-mode">
          {quest === "meal"
            ? "후면 카메라 · 식사 사진 촬영"
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
                if (result) confirmMotion();
                else {
                  setSaved(true);
                  setMessage("촬영 기록을 확인했어요. 사진은 이 화면에서만 유지돼요.");
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
      </section>
    </AppShell>
  );
}
