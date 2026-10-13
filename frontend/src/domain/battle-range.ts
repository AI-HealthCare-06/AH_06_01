import {
  colliderStopDistance,
  enemyGeometry,
  playerGeometry,
  arena,
  type ActorGeometry,
} from "./battle-geometry";
import type { MonsterRank } from "./game-policy";

export const playerAttackRange = 7;
export const playerMeleeRange = 2;
export const rangedAttackRange = 7;

// Shared by simulation and the debug overlay. Body contact can occur before
// nominal melee/ranged reach when a character has a wide collider.
export function enemyAttackRange(
  enemy: { ranged: boolean; art: number; rank: MonsterRank },
  dinosaur: number,
  player: ActorGeometry = playerGeometry(dinosaur),
) {
  return Math.max(
    enemy.ranged ? rangedAttackRange : 1,
    colliderStopDistance(enemy.art, enemy.rank, dinosaur, enemy.ranged, player),
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
  return nearest && nearest.distance <= playerAttackRange ? nearest : undefined;
}

// Melee reach is measured from the character's body edge. Requiring a melee
// enemy at its actual approach stop prevents a swing at an approaching mob.
export function inPlayerMeleeRange(
  enemy: { distance: number; art: number; rank: MonsterRank; ranged: boolean },
  player: ActorGeometry,
) {
  const box = enemyGeometry(enemy.distance, enemy.art, enemy.rank, enemy.ranged).collider;
  return (
    Math.max(0, box.x - player.collider.x - player.collider.width) <=
    playerMeleeRange * arena.pixelsPerUnit
  );
}
export function meleeContact(
  enemy: { distance: number; art: number; rank: MonsterRank; ranged: boolean },
  dinosaur: number,
  player = playerGeometry(dinosaur),
) {
  return (
    !enemy.ranged &&
    enemy.distance <= enemyAttackRange(enemy, dinosaur, player) + 1e-6 &&
    inPlayerMeleeRange(enemy, player)
  );
}

export function isPlayerInEnemyRange(
  enemy: { ranged: boolean; art: number; rank: MonsterRank; distance: number },
  dinosaur: number,
  player?: ActorGeometry,
) {
  return enemy.distance <= enemyAttackRange(enemy, dinosaur, player);
}
