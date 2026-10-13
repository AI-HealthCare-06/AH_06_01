import { Fragment } from "react";
import type { ActorGeometry } from "../domain/battle-geometry";
import {
  arena,
  distanceToX,
  enemyGeometry,
  projectileGeometry,
  playerProjectileGeometry,
} from "../domain/battle-geometry";
import type { CombatState } from "../domain/battle";
import {
  enemyAttackRange,
  isPlayerInEnemyRange,
  playerAttackRange,
  playerMeleeRange,
} from "../domain/battle-range";

// Both actors use the simulation's fixed origin, not the artwork's body edges.
function RangeRuler({
  label,
  range,
  origin,
  y,
  status,
}: {
  label: string;
  range: number;
  origin: number;
  y: number;
  status?: string;
}) {
  const end = origin + range * arena.pixelsPerUnit;
  return (
    <>
      <line className="debug-range-ruler" x1={origin} x2={end} y1={y} y2={y} />
      {Array.from({ length: Math.floor(range) + 1 }, (_, unit) => {
        const x = origin + unit * arena.pixelsPerUnit;
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
      <path d={`M${end - 4},${y - 3} l4,3 l-4,3`} />
      <text className="debug-range-label" x={origin} y={y - 5}>
        {label} RANGE {range.toFixed(2)}u{status ? ` ${status}` : ""}
      </text>
    </>
  );
}

export function BattleDebugOverlay({
  actors,
  dinosaur,
  enemies,
  projectiles,
  playerProjectiles,
}: {
  actors: { id: string; geometry: ActorGeometry }[];
  dinosaur: number;
  enemies: CombatState["enemies"];
  projectiles: CombatState["projectiles"];
  playerProjectiles: CombatState["playerProjectiles"];
}) {
  const player = actors.find((actor) => actor.id === "P")!.geometry;
  return (
    <div id="battle-debug-overlay" className="battle-debug-overlay">
      <svg
        viewBox="0 0 354 336"
        role="img"
        aria-label="전투 collider, hitbox와 공격 사거리 디버그 표시"
      >
        <line
          className="debug-range-origin"
          x1={distanceToX(0)}
          x2={distanceToX(0)}
          y1={174}
          y2={arena.ground + 5}
        />
        <text className="debug-range-origin-label" x={distanceToX(0) - 4} y={194} textAnchor="end">
          0u
        </text>
        <g className="debug-player-range" data-range-actor="P" data-range={playerAttackRange}>
          <line
            className="debug-range-boundary"
            x1={distanceToX(playerAttackRange)}
            x2={distanceToX(playerAttackRange)}
            y1={arena.top + 100}
            y2={arena.ground + 5}
          />
          <RangeRuler label="P" range={playerAttackRange} origin={distanceToX(0)} y={185} />
        </g>
        <g className="debug-player-melee" data-range={playerMeleeRange}>
          <RangeRuler
            label="MELEE"
            range={playerMeleeRange}
            origin={player.collider.x + player.collider.width}
            y={170}
            status="CONTACT"
          />
        </g>
        {enemies.map((enemy, index) => {
          const range = enemyAttackRange(enemy, dinosaur, player);
          const x = distanceToX(enemy.distance);
          const boundary = distanceToX(range);
          const y = 209 + (index % 3) * 23;
          const inside = isPlayerInEnemyRange(enemy, dinosaur, player);
          const remaining = Math.max(0, enemy.distance - range);
          const body = enemyGeometry(enemy.distance, enemy.art, enemy.rank, enemy.ranged).hitbox;
          return (
            <g
              key={enemy.id}
              className="debug-enemy-range"
              data-range-actor={`M${enemy.id}`}
              data-range={range}
              data-distance={enemy.distance}
              data-in-range={inside}
            >
              <line
                className="debug-range-boundary"
                x1={boundary}
                x2={boundary}
                y1={y - 4}
                y2={y + 4}
              />
              <line className="debug-range-remaining" x1={boundary} x2={x} y1={y} y2={y} />
              <RangeRuler
                label={`M${enemy.id}`}
                range={range}
                origin={distanceToX(0)}
                y={y}
                status={inside ? "IN" : "OUT"}
              />
              <line
                className="debug-range-anchor"
                x1={x}
                x2={body.x}
                y1={y}
                y2={body.y + body.height / 2}
              />
              <path
                className="debug-range-position"
                data-position-x={x}
                d={`M${x},${y - 4} l4,4 l-4,4 l-4,-4 Z`}
              />
              <text className="debug-range-detail" x={distanceToX(0)} y={y + 11}>
                현재 {enemy.distance.toFixed(2)}u ·{" "}
                {inside ? `쿨타임 ${Math.ceil(enemy.attackIn)}ms` : `남음 ${remaining.toFixed(2)}u`}
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
        {projectiles.map((projectile, index) => {
          const box = projectileGeometry(projectile, dinosaur).hitbox;
          return (
            <g key={projectile.id} data-debug-projectile={projectile.id}>
              <rect
                className="debug-projectile"
                data-box="hitbox"
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
              />
              <text className="debug-box-label debug-projectile-label" x={box.x} y={box.y - 3}>
                S{index + 1} HIT
              </text>
            </g>
          );
        })}
        {playerProjectiles.map((shot, index) => {
          const box = playerProjectileGeometry(shot).hitbox;
          return (
            <g key={shot.id} data-debug-projectile={shot.id}>
              <rect
                className="debug-player-projectile"
                data-box="hitbox"
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
              />
              <text
                className="debug-box-label debug-player-projectile-label"
                x={box.x}
                y={box.y - 3}
              >
                P{index + 1} HIT
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
