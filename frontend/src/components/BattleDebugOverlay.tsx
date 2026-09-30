import { Fragment } from "react";
import type { ActorGeometry } from "../domain/battle-geometry";
import { arena, distanceToX } from "../domain/battle-geometry";
import type { CombatState } from "../domain/battle";
import { enemyAttackRange, playerAttackRange } from "../domain/battle-range";

// Both directions use the same unit conversion, ticks and label format.
function RangeRuler({
  label,
  range,
  origin,
  direction,
  y,
  status,
}: {
  label: string;
  range: number;
  origin: number;
  direction: 1 | -1;
  y: number;
  status?: string;
}) {
  const end = origin + direction * range * arena.pixelsPerUnit;
  return (
    <>
      <line className="debug-range-ruler" x1={origin} x2={end} y1={y} y2={y} />
      {Array.from({ length: Math.floor(range) + 1 }, (_, unit) => {
        const x = origin + direction * unit * arena.pixelsPerUnit;
        return (
          <line
            key={unit}
            className="debug-range-tick"
            data-range-tick={unit}
            x1={x}
            x2={x}
            y1={y - 3}
            y2={y + 3}
          />
        );
      })}
      <path d={`M${end - direction * 4},${y - 3} l${direction * 4},3 l${-direction * 4},3`} />
      <text
        className="debug-range-label"
        x={origin}
        y={y - 5}
        textAnchor={direction === 1 ? "start" : "end"}
      >
        {label} RANGE {range.toFixed(2)}u{status ? ` ${status}` : ""}
      </text>
    </>
  );
}

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
        <small>X축 공통 단위 · 1u = {arena.pixelsPerUnit}px · IN: 사거리 안</small>
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
          <RangeRuler
            label="P"
            range={playerAttackRange}
            origin={distanceToX(0)}
            direction={1}
            y={185}
          />
        </g>
        {enemies.map((enemy, index) => {
          const range = enemyAttackRange(enemy, dinosaur);
          const x = distanceToX(enemy.distance);
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
              <RangeRuler
                label={`M${enemy.id}`}
                range={range}
                origin={x}
                direction={-1}
                y={y}
                status={inside ? "IN" : "OUT"}
              />
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
