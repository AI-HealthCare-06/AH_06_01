import { colliderStopDistance } from "./battle-geometry";
import type { MonsterRank } from "./game-policy";

export const playerAttackRange = 3;
export const rangedAttackRange = 7;

// Shared by simulation and the debug overlay. Body contact can occur before
// nominal melee/ranged reach when a character has a wide collider.
export function enemyAttackRange(
  enemy: { ranged: boolean; art: number; rank: MonsterRank },
  dinosaur: number,
) {
  return Math.max(
    enemy.ranged ? rangedAttackRange : 1,
    colliderStopDistance(enemy.art, enemy.rank, dinosaur, enemy.ranged),
  );
}

export function selectPlayerTarget<T extends { id: number; distance: number; ranged: boolean }>(
  enemies: T[],
) {
  const nearest = enemies.reduce<T | undefined>(
    (best, enemy) =>
      !best ||
      enemy.distance < best.distance ||
      (enemy.distance === best.distance && enemy.id < best.id)
        ? enemy
        : best,
    undefined,
  );
  return nearest &&
    (nearest.distance <= playerAttackRange || enemies.every((enemy) => enemy.ranged))
    ? nearest
    : undefined;
}

export function isPlayerInEnemyRange(
  enemy: { ranged: boolean; art: number; rank: MonsterRank; distance: number },
  dinosaur: number,
) {
  return enemy.distance <= enemyAttackRange(enemy, dinosaur);
}
