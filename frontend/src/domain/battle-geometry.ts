// Coordinates are in the 354 × 336 design canvas, independent of CSS scale and
// transparent sprite margins. Colliders describe bodies; hitboxes receive hits.
export type BattleBox = { x: number; y: number; width: number; height: number };
export type ActorGeometry = { sprite: BattleBox; collider: BattleBox; hitbox: BattleBox };
export const arena = { top: 58, height: 218, ground: 253, pixelsPerUnit: 30 };
export function center(box: BattleBox) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
export function overlaps(a: BattleBox, b: BattleBox) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
// Nontransparent resting-pose bounds in BattleSprite's 160 × 120 render buffer.
// Character order follows battleDinosaurs; Pteranodon uses walking frame zero.
// Keep these stable during attacks/hit reactions so collision size does not pulse.
const characterBounds = [
  [0, 7, 160, 113],
  [0, 8, 160, 112],
  [0, 15, 160, 105],
  [0, 19, 160, 101],
  [0, 34, 160, 86],
  [21, 0, 119, 120],
] as const;
const monsterBounds = [
  [46, 0, 69, 120],
  [47, 0, 66, 120],
  [31, 0, 98, 120],
  [20, 0, 119, 120],
  [27, 0, 106, 120],
  [32, 0, 97, 120],
] as const;
function geometry(
  sprite: BattleBox,
  bounds: readonly [number, number, number, number],
): ActorGeometry {
  const [x, y, width, height] = bounds;
  const hitbox = {
    x: sprite.x + (sprite.width * x) / 160,
    y: sprite.y + (sprite.height * y) / 120,
    width: (sprite.width * width) / 160,
    height: (sprite.height * height) / 120,
  };
  return {
    sprite,
    hitbox,
    collider: {
      x: hitbox.x - hitbox.width * 0.05,
      y: hitbox.y - hitbox.height * 0.05,
      width: hitbox.width * 1.1,
      height: hitbox.height * 1.1,
    },
  };
}
export function playerGeometry(dinosaur: number): ActorGeometry {
  const flying = dinosaur === 4;
  const sprite = { x: 8, y: flying ? 84 : arena.ground - 98, width: 125, height: 98 };
  return geometry(sprite, characterBounds[dinosaur]);
}
export function enemyGeometry(distance: number, art: number, rank = "normal"): ActorGeometry {
  const large = rank !== "normal";
  const sprite = {
    x: 68 + distance * arena.pixelsPerUnit,
    y: arena.ground - (large ? 74.2 : 65.1),
    width: large ? 65.8 : 57.4,
    height: large ? 74.2 : 65.1,
  };
  return geometry(sprite, monsterBounds[art]);
}
// The physical body must never cross the player, even after saved/custom input.
// Normal melee/ranged stopping ranges remain the policy's 1 / 2 world units.
export function colliderStopDistance(art: number, rank = "normal", dinosaur = 0) {
  const player = playerGeometry(dinosaur).collider;
  const enemy = enemyGeometry(0, art, rank).collider;
  return Math.max(0, (player.x + player.width - enemy.x) / arena.pixelsPerUnit);
}
const strikePoints = [
  [0.9, 0.7],
  [0.9, 0.72],
  [0.9, 0.72],
  [0.86, 0.65],
  [0.9, 0.85],
  [0.87, 0.7],
];
export function attackEndpoint(dinosaur: number, target: BattleBox) {
  const sprite = playerGeometry(dinosaur).sprite;
  const [x, y] = strikePoints[dinosaur];
  const contact = center(target);
  return { x: contact.x - sprite.width * x, y: contact.y - sprite.height * y, contact };
}
export function attackPosition(dinosaur: number, target: BattleBox | null, progress: number) {
  const start = playerGeometry(dinosaur).sprite;
  if (!target) return start;
  const end = attackEndpoint(dinosaur, target);
  // Contact at 30% of the sheet, then recover to the exact resting anchor.
  const travel = progress <= 0.3 ? progress / 0.3 : (1 - progress) / 0.7;
  const amount = Math.max(0, Math.min(1, travel));
  return {
    ...start,
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}
