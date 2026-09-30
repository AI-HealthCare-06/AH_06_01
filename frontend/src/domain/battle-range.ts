import { colliderStopDistance } from "./battle-geometry";
import type { MonsterRank } from "./game-policy";

export const playerAttackRange = 3;

// Shared by simulation and the debug overlay. Body contact can occur before
// nominal melee/ranged reach when a character has a wide collider.
export function enemyAttackRange(
  enemy: { ranged: boolean; art: number; rank: MonsterRank },
  dinosaur: number,
) {
  return Math.max(enemy.ranged ? 2 : 1, colliderStopDistance(enemy.art, enemy.rank, dinosaur));
}

export function isPlayerInEnemyRange(
  enemy: { ranged: boolean; art: number; rank: MonsterRank; distance: number },
  dinosaur: number,
) {
  return enemy.distance <= enemyAttackRange(enemy, dinosaur);
}
