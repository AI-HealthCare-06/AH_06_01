import { DesignCanvas } from "./DesignCanvas";
import { assets } from "../design/assets";
import { dinosaurs } from "../design/dinosaurs";
import { stageProgress } from "../domain/game";
import type { GameState } from "../domain/game";
import { AnimatedNumber } from "./AnimatedNumber";

export function AdventureScene({
  game,
  paused,
  onTogglePause,
}: {
  game: GameState;
  paused: boolean;
  onTogglePause: () => void;
}) {
  const a = assets.home;
  const dino = dinosaurs[game.dinosaur];
  const stage = stageProgress(game);
  return (
    <div className={`adventure ${paused ? "paused" : ""}`} data-paused={paused}>
      <DesignCanvas width={354} height={336}>
        <img
          className="adventure-background"
          src={a.imgFeedbackDinoMessage}
          alt="픽셀 아트 숲과 산"
        />
        <div className="adventure-title">
          <h2>DAILY ADVENTURE</h2>
          <p>건강한 습관이 더 강한 나를 만들어요!</p>
          <strong className="stage-label">
            STAGE 1-1<small>GREEN FOREST</small>
          </strong>
        </div>
        <div className="battle-hud">
          <img className="hp-heart" src={a.imgHpBarPixelHeart} alt="" />
          <div className="hp-stats">
            <span className="level">Lv.12 · {dino.name}</span>
            <div
              className="hp-bar"
              role="meter"
              aria-label="공룡 체력"
              aria-valuenow={320}
              aria-valuemin={0}
              aria-valuemax={320}
            >
              <i className="metric-fill" />
              <strong>
                <AnimatedNumber value={320} /> / 320
              </strong>
            </div>
          </div>
        </div>
        <button
          className="pause-adventure"
          onClick={onTogglePause}
          aria-label={paused ? "모험 재개" : "모험 일시정지"}
          aria-pressed={paused}
        >
          <span aria-hidden="true" className={paused ? "play-symbol" : "pause-symbol"} />
        </button>
        <img
          className="idle-dino battle-animated"
          src={game.dinosaur === 0 ? a.imgDinoIdle : dino.image}
          alt={dino.name}
        />
        <img
          className="enemy enemy-one battle-animated"
          src={a.imgEnemyPixelMonster}
          alt="픽셀 몬스터"
        />
        <img className="enemy enemy-two" src={a.imgEnemyPixelMonster} alt="" />
        <img className="impact battle-animated" src={a.imgFxImpactSprite} alt="" />
        <b className="damage battle-animated" aria-hidden="true">
          -32
        </b>
        <b className="floating-coins battle-animated" aria-hidden="true">
          ◉ +10
        </b>
        <div className="stage-progress">
          <span>STAGE PROGRESS</span>
          <b>
            <AnimatedNumber value={stage} /> / 10
          </b>
          <div className="stage-track">
            <i className="metric-fill" style={{ width: `${stage * 10}%` }} />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <img
              key={i}
              className="stage-dot"
              style={{ left: 79.5 + i * 55.5 }}
              src={i < 2 ? a.imgEllipse : a.imgEllipse1}
              alt=""
            />
          ))}
          <img className="stage-flag" src={a.imgStageProgressGoalFlag} alt="목표" />
          <img
            className="stage-egg"
            src={a.imgStageProgressEggMarker}
            alt="현재 위치"
            style={{ left: 26 + stage * 27.8 - 13 }}
          />
        </div>
      </DesignCanvas>
    </div>
  );
}
