import { useEffect, useState } from "react";
import { DesignCanvas } from "./DesignCanvas";
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
import { battleBuffStats, battleStage, questBuffs } from "../domain/battle";
import { Link } from "react-router-dom";
import { experienceProgress } from "../domain/experience";

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
  const buffs = battleBuffStats(game.completed);
  const experience = experienceProgress(game.experience);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (stopped) return;
    const timer = window.setInterval(() => {
      const nextEnemy = Math.floor(Math.random() * villains.length);
      setBattle((current) =>
        advanceBattle(
          current,
          80 *
            (current.phase === "attack"
              ? buffs.attackSpeed
              : current.phase === "move"
                ? buffs.moveSpeed
                : 1),
          nextEnemy,
        ),
      );
    }, 80);
    return () => clearInterval(timer);
  }, [stopped, buffs.attackSpeed, buffs.moveSpeed]);
  useEffect(() => {
    if (battle.phase === "move") collectCoin(battle.encounter);
  }, [battle.phase, battle.encounter, collectCoin]);
  const dino = dinosaurs[game.dinosaur];
  const art = battleDinosaurs[game.dinosaur];
  const skin = getSkin(game.dinosaurStyles[game.dinosaur]);
  const stageState = battleStage(battle.encounter);
  const stageIndex = (stageState.world - 1) % stages.length;
  const stage = stages[stageIndex];
  const progress = stageState.progress + (battle.phase === "move" ? 1 : 0);
  const progressRatio = progress / stageState.target;
  const enemy = villains[battle.enemy];
  const attack = battle.phase === "attack" && art.attack;
  const attackTime = battle.phase === "attack" ? battle.elapsed / battleDurations.attack : 0;
  const approach =
    battle.phase === "attack" && !reducedMotion
      ? Math.min(1, attackTime / 0.42) * (attackTime > 0.78 ? (1 - attackTime) / 0.22 : 1)
      : 0;
  const flying = art.movement === "fly";
  const wingPhase =
    flying && battle.phase !== "attack" && !reducedMotion
      ? (battle.elapsed % (battle.phase === "move" ? 560 : 960)) /
        (battle.phase === "move" ? 560 : 960)
      : undefined;
  const offset =
    battle.encounter * 70 +
    (battle.phase === "move" ? (battle.elapsed / battleDurations.move) * 70 : 0);
  return (
    <div
      className={`adventure pixel-battle ${stopped ? "paused" : ""}`}
      data-paused={paused}
      data-phase={battle.phase}
      data-encounter={battle.encounter}
      data-stage={stageState.world}
      data-substage={stageState.substage}
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
            STAGE {stageState.world}-{stageState.substage}
            <small>{stage.name}</small>
          </strong>
        </div>
        <div className="battle-hud">
          <div className="hp-stats">
            <span className="level">
              Lv.{experience.level} · {dino.name}
            </span>
            <div
              className="hp-bar"
              role="meter"
              aria-label="공룡 체력"
              aria-valuenow={buffs.maxHp}
              aria-valuemin={0}
              aria-valuemax={buffs.maxHp}
            >
              <i />
              <strong>
                {buffs.maxHp} / {buffs.maxHp}
              </strong>
            </div>
            <div
              className="exp-bar"
              role="progressbar"
              aria-label="레벨 경험치"
              aria-valuemin={0}
              aria-valuemax={experience.required}
              aria-valuenow={experience.current}
              aria-valuetext={`레벨 ${experience.level}, ${experience.current} / ${experience.required} EXP`}
            >
              <i style={{ width: `${(experience.current / experience.required) * 100}%` }} />
              <strong>
                EXP {String(experience.current).padStart(3, "0")}/
                {String(experience.required).padStart(3, "0")}
              </strong>
            </div>
          </div>
          <div className="battle-buffs" aria-label="오늘의 퀘스트 버프">
            {questBuffs.map((buff) => {
              const active = game.completed.includes(buff.id);
              return (
                <Link
                  key={buff.id}
                  to={`/quests/${buff.id}`}
                  data-active={active}
                  title={`${buff.label}: ${buff.effect} · ${active ? "활성" : "퀘스트 완료 시 활성"}`}
                  aria-label={`${buff.label} 버프 ${active ? "활성" : "비활성"}: ${buff.effect}`}
                >
                  <span>{buff.label}</span>
                  <b aria-hidden="true">{active ? "+" : "·"}</b>
                </Link>
              );
            })}
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
          style={{
            left: 52 + approach * 110,
            ...(flying ? { bottom: 112 - approach * 32, rotate: `${approach * 12}deg` } : {}),
          }}
        >
          <BattleSprite
            src={attack || (flying ? art.attack! : art.image)}
            frame={
              attack && !reducedMotion
                ? Math.min(7, Math.floor(battle.elapsed / 120))
                : flying || attack
                  ? 0
                  : undefined
            }
            wingPhase={wingPhase}
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
          <div className="battle-coin" aria-label={`몬스터 처치 보상 ${buffs.coinReward}코인`}>
            <PixelIcon name="coin" />
            <b>+{buffs.coinReward}</b>
          </div>
        )}
        <div className="stage-progress">
          <span>STAGE PROGRESS</span>
          <b>
            <AnimatedNumber value={progress} /> / {stageState.target}
          </b>
          <div
            className="stage-track risk-track"
            role="progressbar"
            aria-label="스테이지 몬스터 처치"
            aria-valuemin={0}
            aria-valuemax={stageState.target}
            aria-valuenow={progress}
          >
            <i style={{ width: `${progressRatio * 100}%` }} />
          </div>
        </div>
      </DesignCanvas>
    </div>
  );
}
