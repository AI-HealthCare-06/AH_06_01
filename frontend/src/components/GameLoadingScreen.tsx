import { createPortal } from "react-dom";
import { dinosaurFaces, stages } from "../design/battle-assets";
import { dinosaurs } from "../design/dinosaurs";
import { useGameStore } from "../stores/game-store";

type LoadingStage = "boot" | "account" | "checking" | "downloading" | "applying";
const messages = {
  boot: ["공룡을 깨우고 있어요", "오늘도 함께 모험을 떠나요."],
  account: ["지난 모험을 불러와요", "나의 공룡과 기록을 준비하고 있어요."],
  checking: ["모험을 준비하고 있어요", "새로운 소식이 있는지 살펴볼게요."],
  downloading: ["새로운 모험이 도착했어요", "필요한 내용을 가져오고 있어요."],
  applying: ["이제 모험을 시작해요", "새 버전을 적용하고 있어요. 잠시만 기다려 주세요."],
} as const;

export function GameLoadingScreen({
  stage,
  progress,
  version,
}: {
  stage: LoadingStage;
  progress?: number;
  version?: string | null;
}) {
  const selected = useGameStore((state) => state.game.dinosaur);
  const dinosaur = dinosaurs[selected] ?? dinosaurs[0];
  const [title, message] = messages[stage];
  const measured = stage === "downloading" || stage === "applying";
  const percent = Math.round(Math.max(0, Math.min(100, progress ?? 0)));
  return createPortal(
    <main className="game-loading-screen" aria-label="모험 로딩 화면" data-stage={stage}>
      <div className="game-loading-screen__content">
        <header className="game-loading-screen__brand">
          <span>DAILY HEALTH ADVENTURE</span>
          <strong>REXRUN</strong>
          <span className="game-loading-screen__tag">나의 공룡과 함께하는 매일의 모험</span>
        </header>
        <div
          className="game-loading-screen__world"
          style={{ backgroundImage: `url(${stages[0].image})` }}
          aria-hidden="true"
        >
          <span className="game-loading-screen__spark game-loading-screen__spark--one">✦</span>
          <span className="game-loading-screen__spark game-loading-screen__spark--two">✦</span>
          <img src={dinosaurFaces[selected] ?? dinosaurFaces[0]} alt="" />
          <span className="game-loading-screen__platform" />
        </div>
        <section className="game-loading-screen__panel" role="status" aria-live="polite">
          <div className="game-loading-screen__meta">
            <span>
              LOADING<span className="game-loading-screen__dots">...</span>
            </span>
            <span>{version ? `v${version}` : dinosaur.name}</span>
          </div>
          <h1>{title}</h1>
          <p>{message}</p>
          <progress
            aria-label={measured ? "업데이트 진행률" : "모험 준비 중"}
            max={100}
            value={measured ? percent : undefined}
          />
          <div className="game-loading-screen__meta game-loading-screen__status">
            <span>{stage === "applying" ? "READY TO GO!" : "ADVENTURE AWAITS"}</span>
            <span>{measured ? `${percent}%` : "준비 중"}</span>
          </div>
        </section>
        <p className="game-loading-screen__hint">지금까지의 모험은 그대로 이어져요.</p>
        <footer className="game-loading-screen__footer">작은 실천이 공룡을 자라게 해요</footer>
      </div>
    </main>,
    document.body,
  );
}
