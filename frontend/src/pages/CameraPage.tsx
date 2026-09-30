import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell, PageHeading } from "../components/AppShell";
import { PixelIcon } from "../components/PixelIcon";
import { quests } from "../domain/game";
const cameraQuests = quests.filter((q) => ["medicine", "meal", "water"].includes(q.id));
const facingFor = (quest: string) => (quest === "meal" ? "environment" : "user");

export function CameraPage() {
  const [params] = useSearchParams();
  const [quest, setQuest] = useState(
    cameraQuests.some((q) => q.id === params.get("quest")) ? params.get("quest")! : "meal",
  );
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("실천한 순간을 사진으로 남겨 보세요.");
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef(0);

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

  async function start(nextQuest = quest) {
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
          facingMode: { ideal: facingFor(nextQuest) },
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
      setMessage(
        nextQuest === "meal"
          ? "음식을 세로 화면에 담고 촬영해 주세요."
          : "얼굴과 실천하는 모습을 화면에 담아 주세요. 실시간 자동 인식은 준비 중이에요.",
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
    stop();
    setLive(false);
    setMessage("사진을 확인해 주세요.");
  }
  return (
    <AppShell active="camera">
      <PageHeading title="QUEST CAMERA" subtitle="오늘의 건강한 순간을 한 장에 담아요" />
      <section className="camera-card">
        <label className="camera-quest-select">
          기록할 퀘스트
          <select
            value={quest}
            disabled={!!photo || busy}
            onChange={(event) => {
              const next = event.target.value;
              setQuest(next);
              if (live) void start(next);
            }}
          >
            {cameraQuests.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title}
              </option>
            ))}
          </select>
        </label>
        <p className="camera-mode">
          {quest === "meal" ? "후면 카메라 · 식사 사진 촬영" : "전면 카메라 · 실시간 인식 준비"}
        </p>
        <div className={`camera-viewfinder ${live ? "live" : ""}`} data-facing={facingFor(quest)}>
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            hidden={!live}
            aria-label="실시간 카메라 화면"
          />
          {photo ? (
            <img src={photo} alt="촬영한 퀘스트 사진" />
          ) : (
            !live && (
              <div className="camera-placeholder">
                <PixelIcon name="camera" />
                <strong>READY TO CAPTURE</strong>
              </div>
            )
          )}
          <span className="viewfinder-corner" aria-hidden="true" />
        </div>
        <p className="camera-status" role="status">
          {message}
        </p>
        {live ? (
          <button className="primary-button shutter-button" onClick={capture}>
            <PixelIcon name="camera" /> 촬영하기
          </button>
        ) : (
          !photo && (
            <button className="primary-button" disabled={busy} onClick={() => void start()}>
              {busy ? "카메라 연결 중…" : "카메라 켜기"}
            </button>
          )
        )}
        {photo && (
          <div className="camera-actions">
            <button onClick={() => void start()}>다시 촬영</button>
            <button
              disabled={saved}
              onClick={() => {
                setSaved(true);
                setMessage("촬영 기록을 확인했어요. 사진은 이 화면에서만 유지돼요.");
              }}
            >
              {saved ? "확인 완료" : "이 사진 사용"}
            </button>
          </div>
        )}
        <p className="camera-note">
          사진은 서버로 전송되지 않아요. 자동 인증 기능은 준비 중이며, 촬영으로 퀘스트가 자동
          완료되지는 않아요.
        </p>
        <Link className="camera-quest-link" to={`/quests/${quest}`}>
          퀘스트로 돌아가기 <PixelIcon name="chevron" />
        </Link>
      </section>
    </AppShell>
  );
}
