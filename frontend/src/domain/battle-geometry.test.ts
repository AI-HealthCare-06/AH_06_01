import { describe, expect, it } from "vitest";
import {
  arena,
  attackEndpoint,
  attackPosition,
  center,
  colliderStopDistance,
  enemyGeometry,
  overlaps,
  playerGeometry,
} from "./battle-geometry";

describe("separate battle bodies and hit targets", () => {
  it("enlarges Brachio by 20% while keeping its feet on the ground and body boxes in sync", () => {
    const brachio = playerGeometry(5),
      translated = playerGeometry(5, { x: 12, y: -10 });
    expect(brachio.sprite.width).toBe(150);
    expect(brachio.sprite.height).toBeCloseTo(117.6);
    expect(brachio.hitbox.y + brachio.hitbox.height).toBeCloseTo(arena.ground);
    expect(brachio.hitbox.height).toBeGreaterThan(playerGeometry(0).hitbox.height);
    for (const key of ["sprite", "hitbox", "collider"] as const) {
      expect(translated[key].x - brachio[key].x).toBeCloseTo(12);
      expect(translated[key].y - brachio[key].y).toBeCloseTo(-10);
      expect(translated[key].width).toBe(brachio[key].width);
      expect(translated[key].height).toBe(brachio[key].height);
    }
  });
  it("uses narrower cola bodies and larger boss boxes independently of sprite padding", () => {
    const cola = enemyGeometry(2, 0),
      burger = enemyGeometry(2, 3),
      boss = enemyGeometry(2, 5, "boss");
    expect(cola.collider).not.toEqual(cola.hitbox);
    expect(cola.hitbox.width).toBeLessThan(burger.hitbox.width);
    expect(boss.hitbox.height).toBeGreaterThan(burger.hitbox.height);
    for (let character = 0; character < 6; character++)
      for (let art = 0; art < 6; art++) {
        const monster = enemyGeometry(colliderStopDistance(art, "normal", character) + 0.001, art);
        expect(overlaps(playerGeometry(character).collider, monster.collider)).toBe(false);
      }
  });
  it("centers 110% colliders around full bodies and aligns ground characters to monster feet", () => {
    for (let index = 0; index < 6; index++) {
      const player = playerGeometry(index);
      expect(player.sprite.x).toBeLessThan(18);
      expect(player.collider.x).toBeGreaterThanOrEqual(0);
      for (const actor of [player, enemyGeometry(3, index, index === 5 ? "boss" : "normal")]) {
        expect(center(actor.collider).x).toBeCloseTo(center(actor.hitbox).x);
        expect(center(actor.collider).y).toBeCloseTo(center(actor.hitbox).y);
        expect(actor.collider.width / actor.hitbox.width).toBeCloseTo(1.1);
        expect(actor.collider.height / actor.hitbox.height).toBeCloseTo(1.1);
        if (actor !== player || index !== 4)
          expect(actor.hitbox.y + actor.hitbox.height).toBeCloseTo(arena.ground);
      }
    }
  });
  it("aligns every character's strike endpoint to each enemy hitbox and returns home", () => {
    for (let character = 0; character < 6; character++)
      for (let art = 0; art < 6; art++) {
        const target = enemyGeometry(2.7, art, art === 5 ? "boss" : "normal").hitbox;
        const end = attackEndpoint(character, target);
        expect(end.contact).toEqual(center(target));
        expect(attackPosition(character, target, 0.3)).toMatchObject({ x: end.x, y: end.y });
        expect(attackPosition(character, target, 1)).toEqual(playerGeometry(character).sprite);
        expect(attackEndpoint(character, enemyGeometry(1.5, art).hitbox).x).toBeLessThan(end.x);
      }
    const ptera = playerGeometry(4);
    expect(center(ptera.hitbox).y).toBeCloseTo(arena.top + arena.height * 0.6);
    expect(playerGeometry(0).collider).not.toEqual(playerGeometry(0).hitbox);
  });
});
