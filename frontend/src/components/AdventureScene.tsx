import {
  arena,
  center,
  attackPosition,
  enemyGeometry,
  playerGeometry,
} from "../domain/battle-geometry";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DesignCanvas } from "./DesignCanvas";
import { dinosaurs } from "../design/dinosaurs";
import {
  attackFrames,
  battleDinosaurs,
  stages,
  villains,
  villainAnimation,
} from "../design/battle-assets";
import { quests } from "../domain/game";
import type { GameState, QuestId } from "../domain/game";
import { getSkin } from "../design/skins";
import { AnimatedNumber } from "./AnimatedNumber";
import { BattleSprite } from "./BattleSprite";
import { BattleDebugOverlay } from "./BattleDebugOverlay";
import { PixelIcon } from "./PixelIcon";
import {
  battleBuffStats,
  questBuffs,
  waveTarget,
  clearDuration,
  travelDuration,
} from "../domain/battle";
import { stagePolicies } from "../domain/game-policy";
import { experienceProgress } from "../domain/experience";
import { EquippedAccessories } from "./AccessoryCatalog";
import { useGameStore } from "../stores/game-store";

export function AdventureScene({
  game,
  paused,
  onTogglePause,
}: {
  game: GameState;
  paused: boolean;
  onTogglePause: () => void;
}) {
  const battle = game.combat;
  const buffs = battleBuffStats(game);
  const experience = experienceProgress(game.experience);
  const [selected, setSelected] = useState<QuestId | null>(null);
  const [buffsExpanded, setBuffsExpanded] = useState(false);
  const [debugVisible, setDebugVisible] = useState(false);
  const debugChangeLevel = useGameStore((state) => state.debugChangeLevel);
  const hud = useRef<HTMLDivElement>(null);
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
    if (!selected) return;
    const outside = (event: PointerEvent) => {
      if (!hud.current?.contains(event.target as Node)) setSelected(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hud.current?.querySelector<HTMLButtonElement>(`[data-buff="${selected}"]`)?.focus();
        setSelected(null);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [selected]);
  const dino = dinosaurs[game.dinosaur];
  const art = battleDinosaurs[game.dinosaur];
  const skin = getSkin(game.dinosaurStyles[game.dinosaur]);
  const stage = stages[battle.stage - 1];
  const transition = battle.transition;
  const clearing = !!transition && transition.elapsed < clearDuration(transition.kind);
  const walking = !!transition && !clearing;
  const travelProgress =
    transition && !reducedMotion
      ? Math.min(1, transition.elapsed / (clearDuration(transition.kind) + travelDuration))
      : 0;
  const changingStage =
    transition?.kind === "stage" &&
    battle.stage < 5 &&
    experience.level >= stagePolicies[battle.stage].level;
  const stageTransition = transition?.kind === "stage";
  const destinationStage = changingStage ? stages[battle.stage] : stage;
  const nextStageOpacity =
    stageTransition && walking
      ? reducedMotion
        ? 1
        : Math.min(1, (transition.elapsed - clearDuration(transition.kind)) / travelDuration)
      : 0;
  const waveTotal = waveTarget(battle.wave);
  const attackElapsed = battle.lastAttack ? battle.clock - battle.lastAttack.time : 1000;
  const attackDuration = Math.min(500, buffs.attackInterval);
  const attacking = attackElapsed < attackDuration && battle.recovery === 0 && !transition;
  const attack = attacking && art.attack;
  const attackTime = attackElapsed / attackDuration;
  const target = battle.enemies.find((enemy) => enemy.id === battle.lastAttack?.targetId);
  const targetGeometry = battle.lastAttack
    ? enemyGeometry(
        target?.distance ?? battle.lastAttack.distance,
        target?.art ?? battle.lastAttack.art ?? 0,
        target?.rank ?? battle.lastAttack.rank ?? "normal",
        target?.ranged ?? battle.lastAttack.ranged ?? false,
      )
    : null;
  const player = playerGeometry(game.dinosaur);
  const position = attackPosition(
    game.dinosaur,
    attacking && !reducedMotion ? (targetGeometry?.hitbox ?? null) : null,
    attackTime,
  );
  const phase =
    battle.recovery > 0
      ? "recover"
      : clearing
        ? "clear"
        : walking
          ? "walk"
          : attacking
            ? "attack"
            : "idle";
  const dinoSource = attack || (walking ? art.walk : art.idle) || art.image;
  const dinoFrames = attackFrames[dinoSource]?.length;
  const dinoFrame = dinoFrames
    ? reducedMotion
      ? 0
      : attack
        ? Math.min(dinoFrames - 1, Math.floor(attackTime * dinoFrames))
        : Math.floor(battle.clock / 90) % dinoFrames
    : undefined;
  const values = {
    medicine: `공격력 ${buffs.ad} → ${Number(buffs.attack.toFixed(1))} · +${Math.round(buffs.adBonus * 100)}%`,
    meal: `기본 방어력 ${buffs.def} · 받는 피해 −${Math.round(buffs.defBonus * 100)}%`,
    walk: `CRT ${Math.round(buffs.crt * 100)}% · 치명타 피해 ×2.0 · ${(game.steps?.count ?? 0).toLocaleString()}보`,
    water: `공격 간격 ${(buffs.attackInterval / 1000).toFixed(2)}초 · AS ${buffs.asBonus >= 0 ? "+" : ""}${Math.round(buffs.asBonus * 100)}%`,
    sleep: `처치 Gold ×${buffs.gold.toFixed(1)} · ${game.sleepHours !== null ? `${game.sleepHours}시간` : game.completed.includes("sleep") ? "7시간 달성 기록" : "수면 데이터 없음"}`,
  };
  const active = {
    medicine: buffs.adBonus > 0,
    meal: buffs.defBonus > 0,
    walk: buffs.crt > 0,
    water: buffs.asBonus > 0,
    sleep: buffs.gold > 1,
  };
  const selectedBuff = questBuffs.find((buff) => buff.id === selected);
  const farming =
    battle.wave === 10 &&
    (battle.stage === 5 || experience.level < stagePolicies[battle.stage].level);
  return (
    <div
      className={`adventure pixel-battle ${paused ? "paused" : ""}`}
      data-effect={game.battleEffect}
      data-paused={paused}
      data-phase={phase}
      data-encounter={game.battleDefeats}
      data-stage={battle.stage}
      data-substage={battle.wave}
    >
      <DesignCanvas width={354} height={336}>
        <div
          className="battle-scenery"
          role="img"
          aria-label={`${stage.name} 스테이지 배경`}
          style={{
            backgroundImage: `url(${stage.image})`,
            backgroundPositionX: `${(((-(battle.wave - 1 + travelProgress) * stage.width) / stage.height) * arena.height) / 10}px`,
          }}
        />
        {stageTransition && (
          <div
            className="battle-scenery battle-scenery-next"
            aria-hidden="true"
            style={{
              backgroundImage: `url(${destinationStage.image})`,
              backgroundPositionX: changingStage
                ? "0px"
                : `${(((-9 * stage.width) / stage.height) * arena.height) / 10}px`,
              opacity: nextStageOpacity,
            }}
          />
        )}
        <div className="adventure-title">
          <h2>
            STAGE {battle.stage} - <span>{stage.name}</span>
          </h2>
          <strong className="stage-label">WAVE {battle.wave} / 10</strong>
        </div>
        <div className="battle-hud" ref={hud}>
          <div className="hp-stats">
            <span className="level">
              Lv.{experience.level} · {dino.name}
            </span>
            <button
              className="buffs-toggle"
              aria-label={buffsExpanded ? "버프 목록 접기" : "버프 목록 펼치기"}
              aria-expanded={buffsExpanded}
              aria-controls="battle-buffs"
              onClick={() => {
                setBuffsExpanded(!buffsExpanded);
                setSelected(null);
              }}
            >
              {buffsExpanded ? "▴" : "▾"}
            </button>
            <div
              className="hp-bar"
              role="meter"
              aria-label="공룡 체력"
              aria-valuenow={Math.ceil(battle.hp)}
              aria-valuemin={0}
              aria-valuemax={buffs.maxHp}
            >
              <i style={{ width: `${(battle.hp / buffs.maxHp) * 100}%` }} />
              <strong>
                {Math.ceil(battle.hp)} / {buffs.maxHp}
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
          <div
            id="battle-buffs"
            className="battle-buffs"
            aria-label="오늘의 퀘스트 버프"
            hidden={!buffsExpanded}
          >
            {questBuffs.map((buff) => (
              <button
                key={buff.id}
                data-buff={buff.id}
                data-active={active[buff.id]}
                data-debuff={
                  (buff.id === "water" && buffs.asBonus < 0) ||
                  (buff.id === "sleep" && buffs.gold < 1)
                }
                aria-label={`${buff.label} 버프 현황`}
                aria-expanded={selected === buff.id}
                aria-controls={selected === buff.id ? "battle-buff-detail" : undefined}
                onClick={() => setSelected(selected === buff.id ? null : buff.id)}
              >
                {buff.label}
              </button>
            ))}
          </div>
          {selectedBuff && (
            <section
              className="battle-buff-detail"
              id="battle-buff-detail"
              aria-label={`${selectedBuff.label} 상세`}
            >
              <header>
                <strong>
                  {selectedBuff.label} · {selectedBuff.stat}
                </strong>
                <button
                  aria-label="버프 설명 닫기"
                  onClick={() => {
                    hud.current
                      ?.querySelector<HTMLButtonElement>(`[data-buff="${selected}"]`)
                      ?.focus();
                    setSelected(null);
                  }}
                >
                  ×
                </button>
              </header>
              <b>{values[selectedBuff.id]}</b>
              <p>{selectedBuff.effect}</p>
              <Link to={`/quests/${selectedBuff.id}`}>
                연계 퀘스트 · {quests.find((q) => q.id === selectedBuff.id)!.title} ›
              </Link>
            </section>
          )}
        </div>
        <button
          className="pause-adventure"
          onClick={onTogglePause}
          aria-label={paused ? "모험 재개" : "모험 일시정지"}
          aria-pressed={paused}
        >
          <span aria-hidden="true" className={paused ? "play-symbol" : "pause-symbol"} />
        </button>
        {import.meta.env.DEV && (
          <button
            type="button"
            className="battle-debug-toggle"
            aria-label={debugVisible ? "전투 디버그 숨기기" : "전투 디버그 표시"}
            aria-pressed={debugVisible}
            aria-controls="battle-debug-overlay"
            onClick={() => setDebugVisible((visible) => !visible)}
          >
            DEBUG
          </button>
        )}
        <div
          className="battle-dinosaur"
          data-dinosaur={game.dinosaur}
          data-skin={skin.id}
          data-movement={art.movement}
          data-moving={walking && !art.walk && !reducedMotion}
          data-animation={phase}
          data-attacking={!!attack}
          data-collider={JSON.stringify(player.collider)}
          data-hitbox={JSON.stringify(player.hitbox)}
          data-attack-target={targetGeometry ? JSON.stringify(targetGeometry.hitbox) : undefined}
          style={{ left: position.x, top: position.y, bottom: "auto" }}
        >
          <BattleSprite src={dinoSource} frame={dinoFrame} label={dino.name} filter={skin.filter} />
          <EquippedAccessories />
        </div>
        {battle.enemies.map((monster) => {
          const enemy = villains[monster.art];
          const animation = villainAnimation(monster.art, monster.ranged);
          const attackAge = battle.clock - (monster.attackedAt ?? -1000);
          const enemyAttacking = attackAge >= 0 && attackAge < 450;
          const geometry = enemyGeometry(
            monster.distance,
            monster.art,
            monster.rank,
            monster.ranged,
          );
          const hit = battle.clock - monster.hitAt >= 0 && battle.clock - monster.hitAt < 200;
          return (
            <div
              className="battle-enemy"
              key={monster.id}
              data-rank={monster.rank}
              data-hit={hit}
              data-unit={monster.ranged ? "ranged" : "melee"}
              data-animation={hit ? "hit" : enemyAttacking ? "attack" : "idle"}
              data-collider={JSON.stringify(geometry.collider)}
              data-hitbox={JSON.stringify(geometry.hitbox)}
              style={{ left: geometry.sprite.x, top: geometry.sprite.y, bottom: "auto" }}
            >
              <BattleSprite
                src={hit ? animation.hit : enemyAttacking ? animation.attack : animation.image}
                frame={
                  !hit && enemyAttacking
                    ? reducedMotion
                      ? 0
                      : Math.min(7, Math.floor((attackAge / 450) * 8))
                    : 0
                }
                label={enemy.name}
              />
              <small>
                {monster.rank !== "normal" && `${monster.rank.toUpperCase()} · `}
                {enemy.name}
                <span
                  className="enemy-hp"
                  role="meter"
                  aria-label={`${enemy.name} 체력`}
                  aria-valuemin={0}
                  aria-valuemax={monster.maxHp}
                  aria-valuenow={Math.ceil(monster.hp)}
                >
                  <i style={{ width: `${(monster.hp / monster.maxHp) * 100}%` }} />
                </span>
              </small>
            </div>
          );
        })}
        {battle.projectiles.map((projectile) => {
          const progress = 1 - projectile.distance / projectile.origin;
          const target = center(player.hitbox);
          const source = enemyGeometry(
            projectile.origin,
            projectile.art,
            projectile.rank ?? "normal",
            true,
          ).hitbox;
          const x = source.x + (target.x - source.x) * progress;
          const y = center(source).y + (target.y - center(source).y) * progress;
          return (
            <img
              key={projectile.id}
              className="enemy-projectile"
              alt=""
              aria-hidden="true"
              src={villainAnimation(projectile.art, true).projectile}
              style={{ left: x, top: y }}
            />
          );
        })}
        {clearing && (
          <div
            className={`battle-clear battle-clear-${transition.kind}`}
            role="status"
            key={`${battle.stage}-${battle.wave}`}
          >
            <span aria-hidden="true">{transition.kind === "stage" ? "✦ ★ ✦" : "◆ ◆ ◆"}</span>
            <strong>{transition.kind === "stage" ? "STAGE CLEAR!" : "WAVE CLEAR!"}</strong>
            <small>
              STAGE {battle.stage} · WAVE {battle.wave} / 10
            </small>
            {transition.kind === "stage" && <i aria-hidden="true" className="clear-sparks" />}
          </div>
        )}
        {attacking && (
          <b
            className="battle-damage"
            key={`hit-${battle.lastAttack!.time}`}
            aria-hidden="true"
            style={
              targetGeometry
                ? { left: targetGeometry.hitbox.x, top: targetGeometry.hitbox.y - 18 }
                : undefined
            }
          >
            {battle.lastAttack!.critical && "CRT "}−{Math.round(battle.lastAttack!.damage)}
          </b>
        )}
        {battle.loot && battle.clock - battle.loot.time < 720 && (
          <div
            className="battle-coin"
            key={`loot-${battle.loot.time}`}
            aria-label={`몬스터 처치 보상 ${battle.loot.gold} Gold`}
          >
            <PixelIcon name="coin" />
            <b>+{battle.loot.gold} G</b>
          </div>
        )}
        {battle.recovery > 0 && (
          <div className="battle-recovery" role="status">
            회복 중 · {Math.ceil(battle.recovery / 1000)}초 후 WAVE 재시작
          </div>
        )}
        {import.meta.env.DEV && debugVisible && (
          <BattleDebugOverlay
            level={experience.level}
            onChangeLevel={debugChangeLevel}
            dinosaur={game.dinosaur}
            enemies={battle.enemies}
            actors={[
              { id: "P", geometry: player },
              ...battle.enemies.map((enemy) => ({
                id: `M${enemy.id}`,
                geometry: enemyGeometry(enemy.distance, enemy.art, enemy.rank, enemy.ranged),
              })),
            ]}
          />
        )}
        <div className="stage-progress">
          <span>WAVE PROGRESS</span>
          <b>
            <AnimatedNumber value={battle.killed} /> / {waveTotal}
          </b>
          <div
            className="stage-track risk-track"
            role="progressbar"
            aria-label="스테이지 몬스터 처치"
            aria-valuemin={0}
            aria-valuemax={waveTotal}
            aria-valuenow={battle.killed}
          >
            <i style={{ width: `${(battle.killed / waveTotal) * 100}%` }} />
          </div>
          {farming && (
            <small className="wave-caption">
              {farming
                ? battle.stage === 5
                  ? "최종 웨이브 반복 파밍"
                  : `다음 STAGE · Lv.${stagePolicies[battle.stage].level} 해제`
                : ""}
            </small>
          )}
        </div>
      </DesignCanvas>
    </div>
  );
}
