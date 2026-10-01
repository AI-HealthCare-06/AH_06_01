import { describe, expect, it } from "vitest";
import { advanceCombat, battleBuffStats, combatSchema, initialCombat } from "./battle";
import type { CombatState } from "./battle";
import { enemyAttackRange, selectPlayerTarget } from "./battle-range";
import {
  combatPlayerGeometry,
  playerGeometry,
  playerMouthPosition,
  enemyGeometry,
  center,
  sweptContact,
  projectileGeometry,
  playerProjectileGeometry,
} from "./battle-geometry";
import { initialGame } from "./game";
const buffs = battleBuffStats(initialGame());
const ranged = {
  id: 1,
  art: 0,
  rank: "normal" as const,
  ranged: true,
  distance: 7,
  hp: 1000,
  maxHp: 1000,
  ad: 0,
  attackIn: 5000,
  hitAt: -1000,
};
const scenario = (enemies: CombatState["enemies"] = [ranged]) => ({
  ...initialCombat(),
  spawned: enemies.length,
  spawnIn: 5000,
  enemies,
});
describe("ranged attacks and contact melee", () => {
  it.each(["normal", "elite", "boss"] as const)(
    "all six %s melee enemies can reach and damage Ptera at its new height",
    (rank) => {
      const player = playerGeometry(4);
      expect(center(player.hitbox).y).toBeCloseTo(188.8, 5);
      for (let art = 0; art < 6; art++) {
        const enemy = { ...ranged, ranged: false, rank, art, ad: 20, attackIn: 0 };
        enemy.distance = enemyAttackRange(enemy, 4);
        const body = enemyGeometry(enemy.distance, art, rank).hitbox;
        expect(
          Math.min(body.y + body.height, player.hitbox.y + player.hitbox.height) -
            Math.max(body.y, player.hitbox.y),
        ).toBeGreaterThan(0);
        const result = advanceCombat(
          { ...scenario([enemy]), attackIn: 5000 },
          { ...buffs, dinosaur: 4 },
          1,
          50,
        ).combat;
        expect(result.hp).toBe(40);
        expect(result.enemies[0].attackedAt).toBe(50);
      }
    },
  );
  it("Ptera fires diagonally along the stored target aim and hits that target", () => {
    const stats = { ...buffs, dinosaur: 4 };
    const started = advanceCombat(scenario(), stats, 1, 50).combat;
    const launched = advanceCombat(started, stats, 1, 150).combat;
    const shot = launched.playerProjectiles[0];
    expect(shot).toMatchObject(playerMouthPosition(4));
    expect(shot.vx).toBeGreaterThan(0);
    expect(shot.vy).toBeGreaterThan(0);
    expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(240, 5);
    expect(shot.vy / shot.vx).toBeCloseTo(
      (started.lastAttack!.aimY! - shot.y) / (started.lastAttack!.aimX! - shot.x),
      5,
    );
    const moving = advanceCombat({ ...launched, attackIn: 5000 }, stats, 1, 200).combat;
    expect(moving.playerProjectiles[0].y).toBeGreaterThan(shot.y);
    const hit = advanceCombat(moving, stats, 1, 1000).combat;
    expect(hit.enemies[0].hp).toBe(980);
    expect(hit.playerProjectiles).toHaveLength(0);
  });
  it("targets the nearest enemy of either type within 7u, with a stable tie break", () => {
    const melee = { ...ranged, id: 2, ranged: false, distance: 4 };
    expect(selectPlayerTarget([ranged, melee])?.id).toBe(2);
    expect(selectPlayerTarget([{ ...ranged, distance: 3 }, melee])?.id).toBe(1);
    expect(selectPlayerTarget([ranged])?.id).toBe(1);
    expect(selectPlayerTarget([{ ...ranged, distance: 7.01 }])).toBeUndefined();
    expect(selectPlayerTarget([{ ...melee, id: 4 }, melee])?.id).toBe(2);
  });
  it.each([0, 1, 2, 3, 4, 5])(
    "fires dinosaur %i's projectile without moving and damages only on impact",
    (dinosaur) => {
      const stats = { ...buffs, dinosaur };
      const started = advanceCombat(scenario(), stats, 1, 50).combat;
      expect(started.lastAttack).toMatchObject({
        mode: "ranged",
        targetId: 1,
        offsetX: 0,
        offsetY: 0,
      });
      const launched = advanceCombat(started, stats, 1, 150).combat;
      expect(launched.playerProjectiles).toHaveLength(1);
      expect(launched.playerProjectiles[0].dinosaur).toBe(dinosaur);
      expect(launched.playerProjectiles[0]).toMatchObject(playerMouthPosition(dinosaur));
      expect(launched.enemies[0].hp).toBe(1000);
      expect(combatPlayerGeometry(dinosaur, launched.lastAttack, launched.clock)).toEqual(
        playerGeometry(dinosaur),
      );
      const saved = combatSchema.parse(JSON.parse(JSON.stringify(launched)));
      const hit = advanceCombat({ ...saved, attackIn: 5000 }, stats, 1, 1000).combat;
      expect(hit.enemies[0].hp).toBe(980);
      expect(hit.playerProjectiles).toHaveLength(0);
      expect(advanceCombat({ ...hit, attackIn: 5000 }, stats, 1, 500).combat.enemies[0].hp).toBe(
        980,
      );
      expect(launched.enemies[0].hp).toBe(1000);
    },
  );
  it("hits the first intersecting monster even if it was not the original target", () => {
    const launched = advanceCombat(scenario(), buffs, 1, 200).combat;
    launched.enemies.push({ ...ranged, id: 2, art: 3, ranged: false, distance: 4 });
    const result = advanceCombat({ ...launched, attackIn: 5000 }, buffs, 1, 1000).combat;
    expect(result.enemies.find((enemy) => enemy.id === 1)?.hp).toBe(1000);
    expect(result.enemies.find((enemy) => enemy.id === 2)?.hp).toBe(980);
    expect(result.playerProjectiles).toHaveLength(0);
  });
  it("removes a missed projectile at its maximum travel distance", () => {
    const launched = advanceCombat(scenario(), buffs, 1, 200).combat;
    const result = advanceCombat(
      { ...launched, enemies: [], attackIn: 5000 },
      buffs,
      1,
      2000,
    ).combat;
    expect(result.playerProjectiles).toHaveLength(0);
    expect(result.lastHit).toBeNull();
  });
  it("requires actual melee contact, then applies 15% stronger area damage within 2u of the body", () => {
    const melee = { ...ranged, art: 3, ranged: false };
    const stop = enemyAttackRange(melee, 0);
    const approaching = advanceCombat(
      scenario([{ ...melee, distance: stop + 0.3 }]),
      buffs,
      1,
      50,
    ).combat;
    expect(approaching.lastAttack?.mode).toBe("ranged");
    const input = scenario([
      { ...melee, distance: stop },
      { ...melee, id: 2, distance: stop + 0.6 },
      { ...ranged, id: 3 },
    ]);
    const hit = advanceCombat(input, buffs, 1, 200).combat;
    expect(hit.lastAttack?.mode).toBe("melee");
    expect(hit.enemies.map((enemy) => enemy.hp)).toEqual([977, 977, 1000]);
    expect(hit.playerProjectiles).toHaveLength(0);
    const atContact = combatPlayerGeometry(0, hit.lastAttack, hit.clock),
      rest = playerGeometry(0);
    for (const axis of ["x", "y"] as const) {
      const offset = atContact.sprite[axis] - rest.sprite[axis];
      expect(atContact.hitbox[axis] - rest.hitbox[axis]).toBeCloseTo(offset);
      expect(atContact.collider[axis] - rest.collider[axis]).toBeCloseTo(offset);
    }
    expect(atContact.sprite).not.toEqual(rest.sprite);
    expect(combatPlayerGeometry(0, hit.lastAttack, 550)).toEqual(rest);
  });
  it("credits each AoE kill once and banks GOLD after the motion and wave end", () => {
    const melee = { ...ranged, art: 3, ranged: false, hp: 1 },
      stop = enemyAttackRange(melee, 0);
    const input = {
      ...scenario([
        { ...melee, distance: stop },
        { ...melee, id: 2, distance: stop + 0.5 },
      ]),
      spawned: 30,
      killed: 28,
    };
    const hit = advanceCombat(input, buffs, 1, 200);
    expect(hit.defeats).toBe(2);
    expect(hit.gold).toBe(0);
    expect(hit.combat.pendingGold).toBe(60);
    const clear = advanceCombat(
      combatSchema.parse(JSON.parse(JSON.stringify(hit.combat))),
      buffs,
      1,
      350,
    );
    expect(clear.defeats).toBe(0);
    expect(clear.gold).toBe(60);
    expect(clear.combat.transition?.kind).toBe("wave");
    expect(advanceCombat(clear.combat, buffs, 1, 50).gold).toBe(0);
  });
  it("sweeps through thin targets and changing alpha bounds, including moving targets", () => {
    const box = { x: 0, y: 0, width: 4, height: 4 };
    expect(sweptContact(box, { ...box, x: 100 }, { ...box, x: 50, width: 1 })).toBeCloseTo(0.46);
    expect(sweptContact(box, { ...box, y: 100 }, { ...box, x: 50 })).toBeNull();
    expect(sweptContact(box, { ...box, width: 12 }, { ...box, x: 8 })).toBeCloseTo(0.5);
    expect(sweptContact(box, box, { ...box, x: 50 }, { ...box, x: -10 })).toBeCloseTo(46 / 60);
  });
  it("uses swept collision inside the simulation and removes the shot in the same tick", () => {
    const enemy = { ...ranged, distance: 5 },
      body = enemyGeometry(5, 0, "normal", true).hitbox;
    const input = {
      ...scenario([enemy]),
      attackIn: 5000,
      playerProjectiles: [
        {
          id: "fast",
          dinosaur: 0,
          x: body.x - 30,
          y: center(body).y,
          vx: 2400,
          vy: 0,
          age: 0,
          travelled: 0,
          damage: 20,
          critical: false,
        },
      ],
    };
    const hit = advanceCombat(input, buffs, 1, 50).combat;
    expect(hit.enemies[0].hp).toBe(980);
    expect(hit.playerProjectiles).toHaveLength(0);
  });
  it("registers first contact caused by projectile growth and removes it after one hit", () => {
    const body = enemyGeometry(7, 0, "normal", true).hitbox;
    const input = {
      ...scenario([ranged, { ...ranged, id: 2, distance: 7.5 }]),
      attackIn: 5000,
      playerProjectiles: [
        {
          id: "growing",
          dinosaur: 0,
          x: body.x - 24.52,
          y: center(body).y,
          vx: 0,
          vy: 0,
          age: 70,
          travelled: 0,
          damage: 20,
          critical: false,
        },
      ],
    };
    const before = playerProjectileGeometry(input.playerProjectiles[0]).hitbox;
    expect(before.x + before.width).toBeLessThan(body.x);
    const hit = advanceCombat(input, buffs, 1, 50).combat;
    expect(hit.enemies.map((enemy) => enemy.hp)).toEqual([980, 1000]);
    expect(hit.playerProjectiles).toHaveLength(0);
    expect(advanceCombat(hit, buffs, 1, 50).combat.enemies[0].hp).toBe(980);
  });
  it("receives a shot on the moving melee hitbox before it reaches the resting body", () => {
    const rest = playerGeometry(0).hitbox;
    const edge = rest.x + rest.width;
    let distance = 7;
    while (projectileGeometry({ art: 0, origin: 7, distance }, 0).hitbox.x > edge + 15)
      distance -= 0.01;
    const shot = { id: "moving-contact", art: 0, origin: 7, distance, damage: 10 };
    const after = projectileGeometry({ ...shot, distance: distance - 0.3 }, 0).hitbox;
    expect(after.x).toBeGreaterThan(edge);
    const hit = advanceCombat(
      {
        ...scenario([]),
        clock: 100,
        attackIn: 5000,
        projectiles: [shot],
        lastAttack: {
          time: 0,
          duration: 500,
          mode: "melee",
          offsetX: 18,
          offsetY: 0,
          distance: 2,
          damage: 23,
          critical: false,
          resolved: true,
        },
      },
      buffs,
      1,
      50,
    ).combat;
    expect(hit.hp).toBe(40);
    expect(hit.projectiles).toHaveLength(0);
  });
});
