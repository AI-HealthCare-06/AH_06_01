// Coordinates are in the 354 × 336 design canvas, independent of CSS scale and
// transparent sprite margins. Colliders describe bodies; hitboxes receive hits.
import atlases from "../design/animation-atlases.json";
import motions from "../design/motion-atlases.json";
import attackMotions from "../design/dino-attack-atlases.json";
import { meleeSizeMultiplier } from "./game-policy";
export type BattleBox = { x: number; y: number; width: number; height: number };
export type ActorGeometry = { sprite: BattleBox; collider: BattleBox; hitbox: BattleBox };
export const arena = { top: 58, height: 218, ground: 253, pixelsPerUnit: 30 };
export function distanceToX(distance: number) {
  return 68 + distance * arena.pixelsPerUnit;
}
export function center(box: BattleBox) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
export function overlaps(a: BattleBox, b: BattleBox) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
// Nontransparent resting-pose bounds in BattleSprite's 160 × 120 render buffer.
// Character order follows battleDinosaurs; Pteranodon uses walking frame zero.
// Keep these stable during attacks/hit reactions so collision size does not pulse.
export const dinosaurBodyBounds = [
  atlases.bounds.TrexIdleSpritesheet4X3Png as [number, number, number, number],
  motions.bounds.DinoTriceraIdle as [number, number, number, number],
  atlases.bounds.RaptorIdleSpritesheet4X31Png as [number, number, number, number],
  motions.bounds.DinoStegoIdle as [number, number, number, number],
  [0, 34, 160, 86],
  motions.bounds.DinoBrachioIdle as [number, number, number, number],
] as const;
const monsterNames = [
  "DarkCola",
  "HardCandy",
  "SmokyMarshmallow",
  "RottenBurger",
  "ArchmagePop",
  "DrFireball",
];
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
const restingPlayers: ActorGeometry[] = [];
const enemyBodies: ActorGeometry[] = [];
// Reuse stable body dimensions in dense/offline combat; callers only read them.
function translateActor(actor: ActorGeometry, x: number, y = 0): ActorGeometry {
  if (x === 0 && y === 0) return actor;
  return {
    sprite: translateBox(actor.sprite, x, y),
    hitbox: translateBox(actor.hitbox, x, y),
    collider: translateBox(actor.collider, x, y),
  };
}
function translateBox(box: BattleBox, x: number, y: number): BattleBox {
  return { x: box.x + x, y: box.y + y, width: box.width, height: box.height };
}
export function playerGeometry(dinosaur: number, offset = { x: 0, y: 0 }): ActorGeometry {
  if (restingPlayers[dinosaur]) return translateActor(restingPlayers[dinosaur], offset.x, offset.y);
  const flying = dinosaur === 4;
  const bounds = dinosaurBodyBounds[dinosaur];
  const scale = dinosaur === 5 ? 1.2 : 1;
  const width = 125 * scale,
    height = 98 * scale;
  // Anchor the visible flying body at 60% of the battle background's height.
  const flyingY = arena.top + arena.height * 0.6 - ((bounds[1] + bounds[3] / 2) * 98) / 120;
  const sprite = {
    x: 8,
    y: flying ? flyingY : arena.ground - height,
    width,
    height,
  };
  restingPlayers[dinosaur] = geometry(sprite, bounds);
  return translateActor(restingPlayers[dinosaur], offset.x, offset.y);
}
// IDLE-sized mouth anchors on ranged release pose 02. Melee poses never
// release a projectile; Stego's mouth now faces right in its ranged sheet.
const projectileMouthPoints = ["Trex", "Tricera", "Raptor", "Stego", "Ptera", "Brachio"].map(
  (name) => attackMotions.mouthPoints[name as keyof typeof attackMotions.mouthPoints],
);
export function playerMouthPosition(dinosaur: number, actor = playerGeometry(dinosaur)) {
  const [x, y] = projectileMouthPoints[dinosaur];
  return {
    x: actor.sprite.x + (actor.sprite.width * x) / 160,
    y: actor.sprite.y + (actor.sprite.height * y) / 120,
  };
}
export function enemyGeometry(
  distance: number,
  art: number,
  rank = "normal",
  ranged = false,
): ActorGeometry {
  const large = rank !== "normal";
  const key = (ranged ? 12 : 0) + (large ? 6 : 0) + art;
  if (enemyBodies[key]) return translateActor(enemyBodies[key], distance * arena.pixelsPerUnit);
  const name = `${ranged ? "Ranged" : "Melee"}${monsterNames[art]}Idle`;
  const bounds = (atlases.bounds as Record<string, number[]>)[name] as [
    number,
    number,
    number,
    number,
  ];
  const scale = ranged ? 1 : meleeSizeMultiplier;
  const width = (large ? 65.8 : 57.4) * scale;
  const height = (large ? 74.2 : 65.1) * scale;
  const sprite = {
    x: distanceToX(0),
    y: arena.ground - (height * (bounds[1] + bounds[3])) / 120,
    width,
    height,
  };
  enemyBodies[key] = geometry(sprite, bounds);
  return translateActor(enemyBodies[key], distance * arena.pixelsPerUnit);
}
type ProjectilePosition = { origin: number; distance: number; art: number; rank?: string };
export const projectileSize = { width: 28 * 1.4, height: 21 * 1.4 };
// Drawing and collision share the visible alpha bounds, excluding transparent padding.
export function projectileGeometry(projectile: ProjectilePosition, dinosaur: number) {
  const source = enemyGeometry(projectile.origin, projectile.art, projectile.rank, true).hitbox;
  const target = center(playerGeometry(dinosaur).hitbox);
  const progress = Math.max(0, Math.min(1, 1 - projectile.distance / projectile.origin));
  const sprite = {
    x: source.x + (target.x - source.x) * progress - projectileSize.width / 2,
    y: center(source).y + (target.y - center(source).y) * progress - projectileSize.height / 2,
    ...projectileSize,
  };
  const bounds = (atlases.bounds as Record<string, number[]>)[
    `Ranged${monsterNames[projectile.art]}Projectile`
  ] as [number, number, number, number];
  return geometry(sprite, bounds);
}
export function projectileHitsPlayer(
  projectile: ProjectilePosition,
  dinosaur: number,
  player = playerGeometry(dinosaur),
) {
  const a = projectileGeometry(projectile, dinosaur).hitbox;
  const b = player.hitbox;
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}
// The physical body must never cross the player, even after saved/custom input.
// Nominal melee/ranged reach is 1 / 7 world units.
export function colliderStopDistance(
  art: number,
  rank = "normal",
  dinosaur = 0,
  ranged = false,
  actor = playerGeometry(dinosaur),
) {
  const player = actor.collider;
  const enemy = enemyGeometry(0, art, rank, ranged).collider;
  return Math.max(0, (player.x + player.width - enemy.x) / arena.pixelsPerUnit);
}

export type AttackMotion = {
  time: number;
  duration?: number;
  mode?: "melee" | "ranged";
  offsetX?: number;
  offsetY?: number;
};
export function combatPlayerGeometry(dinosaur: number, attack: AttackMotion | null, clock: number) {
  const progress = attack ? (clock - attack.time) / (attack.duration ?? 500) : 1;
  if (!attack || attack.mode !== "melee" || progress < 0 || progress >= 1)
    return playerGeometry(dinosaur);
  const amount = progress <= 0.3 ? progress / 0.3 : (1 - progress) / 0.7;
  return playerGeometry(dinosaur, {
    x: (attack.offsetX ?? 0) * amount,
    y: (attack.offsetY ?? 0) * amount,
  });
}

export type PlayerShotPosition = {
  x: number;
  y: number;
  dinosaur: number;
  age: number;
  vx?: number;
  vy?: number;
};
const dinoNames = ["Trex", "Tricera", "Raptor", "Stego", "Ptera", "Brachio"];
export const playerProjectileSize = {
  width: projectileSize.width * 1.2,
  height: projectileSize.height * 1.2,
};
export function playerProjectileFrame(age: number) {
  return Math.floor(Math.max(0, age) / 80) % 4;
}
export function playerProjectileAngle(shot: PlayerShotPosition) {
  return Math.atan2(shot.vy ?? 0, shot.vx ?? 240);
}
export function playerProjectileGeometry(shot: PlayerShotPosition) {
  const name = `Dino${dinoNames[shot.dinosaur]}Projectile`;
  const frames = (motions.frameBounds as Record<string, number[][]>)[name];
  const bounds = frames[playerProjectileFrame(shot.age)] as [number, number, number, number];
  // Fit the visible pose, preserving its aspect ratio. Authored transparent
  // margins vary, so scaling the padded canvas alone would shrink at loop wrap.
  // Grow 10% of the base envelope every 80ms, up to 2×; age survives save/resume.
  const growth = 1 + Math.min(10, Math.floor(Math.max(0, shot.age) / 80)) * 0.1;
  const fit = Math.min(160 / bounds[2], 120 / bounds[3]) * growth;
  const size = {
    width: playerProjectileSize.width * fit,
    height: playerProjectileSize.height * fit,
  };
  const result = geometry(
    {
      x: shot.x - (size.width * (bounds[0] + bounds[2] / 2)) / 160,
      y: shot.y - (size.height * (bounds[1] + bounds[3] / 2)) / 120,
      ...size,
    },
    bounds,
  );
  const angle = playerProjectileAngle(shot);
  if (!angle) return result;
  // Match the AABB of the rotated visible canvas, using its actual center.
  const cosine = Math.abs(Math.cos(angle)),
    sine = Math.abs(Math.sin(angle));
  const width = result.hitbox.width * cosine + result.hitbox.height * sine;
  const height = result.hitbox.width * sine + result.hitbox.height * cosine;
  const hitbox = { x: shot.x - width / 2, y: shot.y - height / 2, width, height };
  return {
    ...result,
    hitbox,
    collider: {
      x: hitbox.x - width * 0.05,
      y: hitbox.y - height * 0.05,
      width: width * 1.1,
      height: height * 1.1,
    },
  };
}

// Swept AABB: first contact time in [0, 1], including a moving target. This
// prevents a fast shot crossing a thin cola hitbox between simulation ticks.
export function sweptContact(
  from: BattleBox,
  to: BattleBox,
  targetFrom: BattleBox,
  targetTo = targetFrom,
) {
  let enter = 0,
    leave = 1;
  // Each separating edge must overlap. Interpolate both boxes' edges, including
  // changing projectile alpha bounds, so animation cannot skip an impact.
  for (const [start, end] of [
    [from.x + from.width - targetFrom.x, to.x + to.width - targetTo.x],
    [targetFrom.x + targetFrom.width - from.x, targetTo.x + targetTo.width - to.x],
    [from.y + from.height - targetFrom.y, to.y + to.height - targetTo.y],
    [targetFrom.y + targetFrom.height - from.y, targetTo.y + targetTo.height - to.y],
  ]) {
    if (start < 0 && end < 0) return null;
    if (start < 0) enter = Math.max(enter, -start / (end - start));
    else if (end < 0) leave = Math.min(leave, start / (start - end));
    if (enter > leave) return null;
  }
  return enter <= 1 && leave >= 0 ? enter : null;
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
