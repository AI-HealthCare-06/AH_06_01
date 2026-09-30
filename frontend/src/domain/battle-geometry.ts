// Coordinates are in the 354 × 336 design canvas, independent of CSS scale and
// transparent sprite margins. Colliders describe bodies; hitboxes receive hits.
export type BattleBox = { x: number; y: number; width: number; height: number };
export type ActorGeometry = { sprite: BattleBox; collider: BattleBox; hitbox: BattleBox };
export const arena = { top: 58, height: 218, ground: 246, pixelsPerUnit: 30 };
export function center(box: BattleBox) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
export function overlaps(a: BattleBox, b: BattleBox) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function inset(sprite: BattleBox, x: number, y: number, width: number, height: number) {
  return {
    x: sprite.x + sprite.width * x,
    y: sprite.y + sprite.height * y,
    width: sprite.width * width,
    height: sprite.height * height,
  };
}
export function playerGeometry(dinosaur: number): ActorGeometry {
  const flying = dinosaur === 4;
  const sprite = { x: 18, y: flying ? 84 : arena.ground - 98, width: 125, height: 98 };
  return {
    sprite,
    collider: inset(sprite, 0.34, 0.55, 0.34, 0.35),
    hitbox: inset(sprite, 0.3, 0.43, 0.48, 0.48),
  };
}
export function enemyGeometry(distance: number, art: number, rank = "normal"): ActorGeometry {
  const large = rank !== "normal";
  const sprite = {
    x: 68 + distance * arena.pixelsPerUnit,
    y: arena.ground + 7 - (large ? 74.2 : 65.1),
    width: large ? 65.8 : 57.4,
    height: large ? 74.2 : 65.1,
  };
  // Cola is slender; candy and the round food monsters have wider bodies.
  const width = [0.26, 0.48, 0.68, 0.76, 0.66, 0.72][art] ?? 0.6;
  return {
    sprite,
    collider: inset(sprite, 0.5 - width * 0.4, 0.65, width * 0.8, 0.34),
    hitbox: inset(sprite, 0.5 - width / 2, 0.23, width, 0.65),
  };
}
// The physical body must never cross the player, even after saved/custom input.
// Normal melee/ranged stopping ranges remain the policy's 1 / 2 world units.
export function colliderStopDistance(art: number, rank = "normal") {
  const player = playerGeometry(0).collider;
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
