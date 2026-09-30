import { Fragment } from "react";
import type { ActorGeometry } from "../domain/battle-geometry";
import { arena, distanceToX } from "../domain/battle-geometry";
import type { CombatState } from "../domain/battle";
import { enemyAttackRange, playerAttackRange } from "../domain/battle-range";

export function BattleDebugOverlay({
  actors,
  dinosaur,
  enemies,
}: {
  actors: { id: string; geometry: ActorGeometry }[];
  dinosaur: number;
  enemies: CombatState["enemies"];
}) {
  return (
    <div id="battle-debug-overlay" className="battle-debug-overlay">
      <div className="battle-debug-legend">
        <b className="debug-collider-label">━ COLLIDER</b>
        <b className="debug-hitbox-label">┄ HITBOX</b>
        <b className="debug-player-range-label">━ P RANGE</b>
        <b className="debug-enemy-range-label">━ M RANGE</b>
        <span>P: 캐릭터 · M: 몬스터</span>
        <small>X축 논리거리 · 1u = 30px · IN: 사거리 안</small>
        <small>플레이어 판정 위치 고정 · 공격 이동은 모션</small>
      </div>
      <svg
        viewBox="0 0 354 336"
        role="img"
        aria-label="전투 collider, hitbox와 공격 사거리 디버그 표시"
      >
        <g className="debug-player-range" data-range-actor="P" data-range={playerAttackRange}>
          <line
            className="debug-range-boundary"
            x1={distanceToX(playerAttackRange)}
            x2={distanceToX(playerAttackRange)}
            y1={arena.top + 100}
            y2={arena.ground + 5}
          />
          <path
            d={`M${distanceToX(0)},180 v10 M${distanceToX(0)},185 H${distanceToX(playerAttackRange)} v-5 v10`}
          />
          <text className="debug-range-label" x={distanceToX(0)} y={180}>
            P RANGE {playerAttackRange.toFixed(2)}
          </text>
          <text className="debug-range-label" x={distanceToX(0)} y={197}>
            0 → {playerAttackRange}u
          </text>
        </g>
        {enemies.map((enemy, index) => {
          const range = enemyAttackRange(enemy, dinosaur);
          const x = distanceToX(enemy.distance);
          const edge = distanceToX(enemy.distance - range);
          const y = 213 + (index % 3) * 16;
          const inside = enemy.distance <= range;
          return (
            <g
              key={enemy.id}
              className="debug-enemy-range"
              data-range-actor={`M${enemy.id}`}
              data-range={range}
              data-in-range={inside}
            >
              <line x1={edge} x2={x} y1={y} y2={y} />
              <path d={`M${edge + 4},${y - 3} l-4,3 l4,3 M${x},${y - 4} v8`} />
              <text className="debug-range-label" x={x} y={y - 5} textAnchor="end">
                M{enemy.id} {range.toFixed(2)}u {inside ? "IN" : "OUT"}
              </text>
            </g>
          );
        })}
        {actors.map(({ id, geometry }) => (
          <g key={id} data-debug-actor={id}>
            {(["collider", "hitbox"] as const).map((kind) => {
              const box = geometry[kind];
              return (
                <Fragment key={kind}>
                  <rect
                    className={`debug-box debug-${kind}`}
                    data-box={kind}
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                  />
                  <text
                    className={`debug-box-label debug-${kind}-label`}
                    x={box.x}
                    y={kind === "hitbox" ? box.y - 3 : box.y + box.height + 8}
                  >
                    {id} {kind === "hitbox" ? "HIT" : "COL"}
                  </text>
                </Fragment>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
