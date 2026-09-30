import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { CombatState } from "../domain/battle";
import { enemyAttackRange } from "../domain/battle-range";
import { villains } from "../design/battle-assets";

function panelPosition(anchor: HTMLButtonElement | null) {
  const box = anchor?.getBoundingClientRect();
  const width = Math.min(330, window.innerWidth - 16);
  const top = Math.max(56, Math.min(window.innerHeight - 8, box?.top ?? 200));
  return {
    width,
    left: Math.max(8, Math.min(window.innerWidth - width - 8, (box?.right ?? width) - width)),
    bottom: Math.max(8, window.innerHeight - top + 8),
    maxHeight: Math.max(40, Math.min(280, top - 16)),
  };
}

export function BattleDebugPanel({
  anchor,
  level,
  dinosaur,
  enemies,
  onChangeLevel,
  onClose,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  level: number;
  dinosaur: number;
  enemies: CombatState["enemies"];
  onChangeLevel: (delta: number) => void;
  onClose: () => void;
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
        <b className="debug-player-range-label">━ P RANGE</b>
        <b className="debug-enemy-range-label">━ M RANGE</b>
        <small>공통 0u · 1u = 30px · ◆ 몹 현재 위치 · IN: 사거리 안</small>
        <small>플레이어 판정 고정 · 원거리만 남으면 거리 밖까지 돌진</small>
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
              {enemyAttackRange(enemy, dinosaur).toFixed(2)}u
            </span>
            <span>
              공격 0.50s · 이동 {enemy.ranged ? "1.2" : "1.4"}u/s · 쿨타임{" "}
              {Math.ceil(enemy.attackIn)}ms
            </span>
          </article>
        ))}
        {enemies.length === 0 && <p>몬스터 스폰 대기 중</p>}
      </div>
    </section>,
    document.body,
  );
}
