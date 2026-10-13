import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  enemyAttackInterval,
  type CombatState,
  type DebugBuffs,
  type battleBuffStats,
} from "../domain/battle";
import { enemyAttackRange } from "../domain/battle-range";
import type { ActorGeometry } from "../domain/battle-geometry";
import { villains } from "../design/battle-assets";

function panelPosition(anchor: HTMLButtonElement | null) {
  const box = anchor?.getBoundingClientRect();
  const width = Math.min(330, window.innerWidth - 16);
  const top = Math.max(56, Math.min(window.innerHeight - 8, box?.top ?? 200));
  return {
    width,
    left: (window.innerWidth - width) / 2,
    bottom: Math.max(8, window.innerHeight - top + 8),
    maxHeight: Math.max(40, Math.min(280, top - 16)),
  };
}

export function BattleDebugPanel({
  anchor,
  level,
  dinosaur,
  player,
  enemies,
  onChangeLevel,
  onClose,
  buffs,
  onChangeBuff,
  onResetBuffs,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  level: number;
  dinosaur: number;
  player: ActorGeometry;
  enemies: CombatState["enemies"];
  onChangeLevel: (delta: number) => void;
  onClose: () => void;
  buffs: ReturnType<typeof battleBuffStats>;
  onChangeBuff: (key: keyof DebugBuffs, value: number) => void;
  onResetBuffs: () => void;
}) {
  const [placement, setPlacement] = useState(() => panelPosition(anchor.current));
  useEffect(() => {
    const reposition = () => setPlacement(panelPosition(anchor.current));
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    document.addEventListener("keydown", escape);
    // DesignCanvas updates its scale after the window resize event. Follow that
    // transform as well so the portal remains above the rendered button.
    const canvas = anchor.current?.closest(".design-canvas-inner");
    const observer = new MutationObserver(reposition);
    if (canvas) observer.observe(canvas, { attributes: true, attributeFilter: ["style"] });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
      document.removeEventListener("keydown", escape);
    };
  }, [anchor, onClose]);
  return createPortal(
    <section
      id="battle-debug-panel"
      className="battle-debug-panel"
      style={placement}
      aria-label="전투 디버그 설정"
      data-no-swipe
    >
      <header>
        <strong>BATTLE DEBUG</strong>
        <button type="button" onClick={onClose} aria-label="디버그 설정 닫기">
          ×
        </button>
      </header>
      <div className="debug-level-controls">
        <button
          type="button"
          aria-label="디버그 레벨 다운"
          disabled={level <= 1}
          onClick={() => onChangeLevel(-1)}
        >
          −
        </button>
        <strong>Lv.{level}</strong>
        <button
          type="button"
          aria-label="디버그 레벨 업"
          disabled={level >= 100}
          onClick={() => onChangeLevel(1)}
        >
          +
        </button>
        <span>HP 회복 · 보상 없음</span>
      </div>
      <div className="battle-debug-legend">
        <b className="debug-collider-label">━ COLLIDER</b>
        <b className="debug-hitbox-label">┄ HITBOX</b>
        <b className="debug-projectile-label">┄ SHOT</b>
        <b className="debug-player-projectile-label">━ PLAYER SHOT</b>
        <b className="debug-player-range-label">━ P RANGE</b>
        <b className="debug-enemy-range-label">━ M RANGE</b>
        <small>공통 0u · 1u = 30px · ◆ 몹 현재 위치 · IN: 사거리 안</small>
        <small>기본 원거리 7u · 근접 접촉 시 몸체 앞 2u 광역 · 판정은 캐릭터와 이동</small>
      </div>
      <div className="debug-monster-stats" aria-label="몬스터 스탯">
        {enemies.map((enemy) => (
          <article key={enemy.id} data-monster-stats={enemy.id}>
            <strong>
              M{enemy.id} · {villains[enemy.art].name} · {enemy.ranged ? "원거리" : "근거리"} /{" "}
              {enemy.rank.toUpperCase()}
            </strong>
            <span>
              HP {Math.ceil(enemy.hp)}/{enemy.maxHp} · AD {Number(enemy.ad.toFixed(2))} · RANGE{" "}
              {enemyAttackRange(enemy, dinosaur, player).toFixed(2)}u
            </span>
            <span>
              공격 {(enemyAttackInterval(enemy.ranged) / 1000).toFixed(2)}s · 이동{" "}
              {enemy.ranged ? "1.2" : "1.4"}u/s · 쿨타임 {Math.ceil(enemy.attackIn)}ms
            </span>
          </article>
        ))}
        {enemies.length === 0 && <p>몬스터 스폰 대기 중</p>}
      </div>
      <fieldset className="debug-buff-controls">
        <legend>버프 조정 · 이번 실행에만 적용</legend>
        {(
          [
            ["adBonus", "공격력 증가", 0, 300],
            ["defBonus", "피해 감소", 0, 90],
            ["crt", "크리티컬 확률", 0, 100],
            ["asBonus", "공격속도 증가", -80, 300],
            ["gold", "추가 GOLD", -100, 300],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key}>
            <span>{label} %</span>
            <input
              type="number"
              aria-label={`디버그 ${label}`}
              min={min}
              max={max}
              step={10}
              value={Math.round((buffs[key] - (key === "gold" ? 1 : 0)) * 100)}
              onChange={(event) => {
                if (event.target.value !== "")
                  onChangeBuff(key, Number(event.target.value) / 100 + (key === "gold" ? 1 : 0));
              }}
            />
          </label>
        ))}
        <button type="button" onClick={onResetBuffs}>
          실제 퀘스트 버프로 복원
        </button>
      </fieldset>
    </section>,
    document.body,
  );
}
