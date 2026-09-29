import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DesignCanvas } from "./DesignCanvas";
import { dinosaurs } from "../design/dinosaurs";
import { battleDinosaurs, stages, villains } from "../design/battle-assets";
import { quests } from "../domain/game";
import type { GameState, QuestId } from "../domain/game";
import { getSkin } from "../design/skins";
import { AnimatedNumber } from "./AnimatedNumber";
import { BattleSprite } from "./BattleSprite";
import { PixelIcon } from "./PixelIcon";
import { battleBuffStats, questBuffs, waveTarget } from "../domain/battle";
import { stagePolicies, wavePolicies } from "../domain/game-policy";
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
  const battle = game.combat;
  const buffs = battleBuffStats(game);
  const experience = experienceProgress(game.experience);
  const [selected, setSelected] = useState<QuestId | null>(null);
  const [buffsExpanded, setBuffsExpanded] = useState(false);
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
  const wave = wavePolicies[battle.wave - 1];
  const target = waveTarget(battle.wave);
  const attackElapsed = battle.lastAttack ? battle.clock - battle.lastAttack.time : 1000;
  const attackDuration = Math.min(500, buffs.attackInterval);
  const attacking = attackElapsed < attackDuration && battle.recovery === 0;
  const attack = attacking && art.attack;
  const attackTime = attackElapsed / attackDuration;
  const approach = attacking && !reducedMotion ? Math.sin(Math.PI * attackTime) : 0;
  const flying = art.movement === "fly";
  const phase = battle.recovery > 0 ? "recover" : attacking ? "attack" : "idle";
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
            backgroundPositionX: `${-(battle.wave - 1) * 70}px`,
          }}
        />
        <div className="adventure-title">
          <h2>DAILY ADVENTURE</h2>
          <p>건강한 습관이 더 강한 나를 만들어요!</p>
          <strong className="stage-label">
            STAGE {battle.stage}
            <span>WAVE {battle.wave} / 10</span>
            <small>{stage.name}</small>
          </strong>
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
              BUFF {buffsExpanded ? "▴" : "▾"}
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
        <div
          className="battle-dinosaur"
          data-dinosaur={game.dinosaur}
          data-skin={skin.id}
          data-movement={art.movement}
          data-moving={false}
          data-attacking={!!attack}
          style={{
            left: 18 + approach * 80,
            ...(flying
              ? { bottom: 110 - approach * 24, rotate: `${approach * 12}deg` }
              : { bottom: 90 }),
          }}
        >
          <BattleSprite
            src={attack || art.walk || art.image}
            frame={
              attack && !reducedMotion
                ? Math.min(7, Math.floor(attackTime * 8))
                : art.walk
                  ? reducedMotion
                    ? 0
                    : Math.floor((battle.clock % 640) / 160)
                  : attack
                    ? 0
                    : undefined
            }
            label={dino.name}
            filter={skin.filter}
          />
        </div>
        {battle.enemies.map((monster) => {
          const enemy = villains[monster.art];
          const hit = battle.clock - monster.hitAt >= 0 && battle.clock - monster.hitAt < 200;
          return (
            <div
              className="battle-enemy"
              key={monster.id}
              data-rank={monster.rank}
              data-hit={hit}
              style={{ left: 68 + monster.distance * 30, bottom: 90 }}
            >
              <BattleSprite src={hit ? enemy.hit : enemy.image} label={enemy.name} backdrop />
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
        {attacking && (
          <b className="battle-damage" key={`hit-${battle.lastAttack!.time}`} aria-hidden="true">
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
        <div className="stage-progress">
          <span>WAVE PROGRESS</span>
          <b>
            <AnimatedNumber value={battle.killed} /> / {target}
          </b>
          <div
            className="stage-track risk-track"
            role="progressbar"
            aria-label="스테이지 몬스터 처치"
            aria-valuemin={0}
            aria-valuemax={target}
            aria-valuenow={battle.killed}
          >
            <i style={{ width: `${(battle.killed / target) * 100}%` }} />
          </div>
          <small className="wave-caption">
            {farming
              ? battle.stage === 5
                ? "최종 웨이브 반복 파밍"
                : `다음 STAGE · Lv.${stagePolicies[battle.stage].level} 해제`
              : `일반 ${wave.count}${wave.extra ? ` + ${wave.extra.toUpperCase()} 1` : ""} · 5초마다 출현`}
          </small>
        </div>
      </DesignCanvas>
    </div>
  );
}
