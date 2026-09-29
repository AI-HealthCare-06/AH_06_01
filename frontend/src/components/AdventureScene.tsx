import { useEffect, useState } from "react";
import { DesignCanvas } from "./DesignCanvas";
import { assets } from "../design/assets";
import { dinosaurs } from "../design/dinosaurs";
import { battleDinosaurs, stages, villains } from "../design/battle-assets";
import type { GameState } from "../domain/game";
import { advanceBattle, battleDurations } from "../domain/battle";
import type { BattleState } from "../domain/battle";
import { useGameStore } from "../stores/game-store";
import { getSkin } from "../design/skins";
import { AnimatedNumber } from "./AnimatedNumber";
import { BattleSprite } from "./BattleSprite";
import { PixelIcon } from "./PixelIcon";

export function AdventureScene({
  game,
  paused,
  onTogglePause,
}: {
  game: GameState;
  paused: boolean;
  onTogglePause: () => void;
}) {
  const [battle, setBattle] = useState<BattleState>(() => ({
    phase: "spawn",
    elapsed: 0,
    encounter: game.battleDefeats,
    enemy: Math.floor(Math.random() * villains.length),
  }));
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const collectCoin = useGameStore((state) => state.collectCoin);
  const stopped = paused || !visible;
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (stopped) return;
    const timer = window.setInterval(() => {
      const nextEnemy = Math.floor(Math.random() * villains.length);
      setBattle((current) => advanceBattle(current, 80, nextEnemy));
    }, 80);
    return () => clearInterval(timer);
  }, [stopped]);
  useEffect(() => {
    if (battle.phase === "move") collectCoin(battle.encounter);
  }, [battle.phase, battle.encounter, collectCoin]);
  const dino = dinosaurs[game.dinosaur];
  const art = battleDinosaurs[game.dinosaur];
  const skin = getSkin(game.dinosaurStyles[game.dinosaur]);
  const stageIndex = Math.floor(battle.encounter / 10) % stages.length;
  const stage = stages[stageIndex];
  const progress = battle.encounter % 10;
  const enemy = villains[battle.enemy];
  const attack = battle.phase === "attack" && art.attack;
  const attackTime = battle.phase === "attack" ? battle.elapsed / battleDurations.attack : 0;
  const approach =
    battle.phase === "attack"
      ? Math.min(1, attackTime / 0.42) * (attackTime > 0.78 ? (1 - attackTime) / 0.22 : 1)
      : 0;
  const offset =
    progress * 70 + (battle.phase === "move" ? (battle.elapsed / battleDurations.move) * 70 : 0);
  return (
    <div
      className={`adventure pixel-battle ${stopped ? "paused" : ""}`}
      data-paused={paused}
      data-phase={battle.phase}
      data-encounter={battle.encounter}
      data-stage={stageIndex + 1}
    >
      <DesignCanvas width={354} height={336}>
        <div
          className="battle-scenery"
          role="img"
          aria-label={`${stage.name} 스테이지 배경`}
          style={{ backgroundImage: `url(${stage.image})`, backgroundPositionX: `${-offset}px` }}
        />
        <div className="adventure-title">
          <h2>DAILY ADVENTURE</h2>
          <p>건강한 습관이 더 강한 나를 만들어요!</p>
          <strong className="stage-label">
            STAGE {Math.floor(battle.encounter / 60) + 1}-{stageIndex + 1}
            <small>{stage.name}</small>
          </strong>
        </div>
        <div className="battle-hud">
          <img className="hp-heart" src={assets.home.imgHpBarPixelHeart} alt="" />
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
              <i />
              <strong>320 / 320</strong>
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
        <div
          className="battle-dinosaur"
          data-dinosaur={game.dinosaur}
          data-skin={skin.id}
          data-movement={art.movement}
          data-moving={battle.phase === "move"}
          data-attacking={!!attack}
          style={{ left: 52 + approach * 110 }}
        >
          <BattleSprite
            src={attack || art.image}
            frame={attack ? Math.min(7, Math.floor(battle.elapsed / 120)) : undefined}
            label={dino.name}
            filter={skin.filter}
          />
        </div>
        {!["drop", "move"].includes(battle.phase) && (
          <div
            className="battle-enemy"
            key={battle.encounter}
            data-defeated={battle.phase === "defeat"}
            data-spawning={battle.phase === "spawn"}
            data-hit={battle.phase === "attack" && attackTime >= 0.42 && attackTime < 0.78}
          >
            <BattleSprite src={enemy.image} label={enemy.name} backdrop />
            <small>{enemy.name}</small>
          </div>
        )}
        {battle.phase === "defeat" && (
          <b className="battle-damage" aria-hidden="true">
            -32
          </b>
        )}
        {battle.phase === "drop" && (
          <div className="battle-coin" aria-label="몬스터 처치 보상 10코인">
            <PixelIcon name="coin" />
            <b>+10</b>
          </div>
        )}
        <div className="stage-progress">
          <span>STAGE PROGRESS</span>
          <b>
            <AnimatedNumber value={progress} /> / 10
          </b>
          <div
            className="stage-track"
            role="progressbar"
            aria-label="스테이지 몬스터 처치"
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={progress}
          >
            <i style={{ width: `${progress * 10}%` }} />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <i className="pixel-stage-dot" key={i} style={{ left: 79 + i * 55 }} />
          ))}
          <img className="stage-flag" src={assets.home.imgStageProgressGoalFlag} alt="목표" />
          <img
            className="stage-egg"
            src={assets.home.imgStageProgressEggMarker}
            alt="현재 위치"
            style={{ left: 13 + progress * 27.8 }}
          />
        </div>
      </DesignCanvas>
    </div>
  );
}
