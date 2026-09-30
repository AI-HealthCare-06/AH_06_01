import { Fragment } from "react";
import type { ActorGeometry } from "../domain/battle-geometry";

export function BattleDebugOverlay({
  actors,
}: {
  actors: { id: string; geometry: ActorGeometry }[];
}) {
  return (
    <div id="battle-debug-overlay" className="battle-debug-overlay">
      <div className="battle-debug-legend">
        <b className="debug-collider-label">━ COLLIDER</b>
        <b className="debug-hitbox-label">┄ HITBOX</b>
        <span>P: 캐릭터 · M: 몬스터</span>
        <small>플레이어 판정 위치 고정 · 공격 이동은 모션 · 피해는 거리 기반</small>
      </div>
      <svg viewBox="0 0 354 336" role="img" aria-label="전투 collider와 hitbox 디버그 표시">
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
