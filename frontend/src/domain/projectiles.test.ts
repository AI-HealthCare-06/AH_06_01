import { describe, expect, it } from "vitest";
import { advanceCombat, battleBuffStats, initialCombat, projectileSpeed } from "./battle";
import { playerGeometry, projectileGeometry } from "./battle-geometry";
import { initialGame } from "./game";

describe("ranged movement and first contact", () => {
  it("stops all ranged appearances at 3u and approaches again only after knockback", () => {
    for (let dinosaur = 0; dinosaur < 6; dinosaur++) {
      const buffs = { ...battleBuffStats({ ...initialGame(), dinosaur }), attack: 0, defBonus: 1 };
      for (let art = 0; art < 6; art++) {
        const input = {
          ...initialCombat(),
          spawned: 1,
          spawnIn: 5000,
          attackIn: 5000,
          enemies: [
            {
              id: 1,
              art,
              rank: "normal" as const,
              ranged: true,
              hp: 1000,
              maxHp: 1000,
              ad: 20,
              distance: 3.12,
              attackIn: 5000,
              hitAt: -1000,
            },
          ],
        };
        const stopped = advanceCombat(input, buffs, 1, 100).combat;
        expect(stopped.enemies[0].distance).toBeCloseTo(3);
        expect(advanceCombat(stopped, buffs, 1, 1000).combat.enemies[0].distance).toBe(3);
        stopped.enemies[0].distance = 3.2;
        expect(advanceCombat(stopped, buffs, 1, 200).combat.enemies[0].distance).toBe(3);
        stopped.enemies[0].distance = 2.8;
        expect(advanceCombat(stopped, buffs, 1, 500).combat.enemies[0].distance).toBe(2.8);
      }
    }
  });

  it("removes each projectile at the first touching frame for all six player hitboxes", () => {
    for (let dinosaur = 0; dinosaur < 6; dinosaur++) {
      const buffs = battleBuffStats({ ...initialGame(), dinosaur });
      const player = playerGeometry(dinosaur).hitbox;
      for (let art = 0; art < 6; art++) {
        let state = {
          ...initialCombat(),
          spawned: 1,
          spawnIn: 5000,
          projectiles: [{ id: "shot", art, origin: 3, distance: 3, damage: 10 }],
        };
        let impact = false;
        for (let tick = 0; tick < 10 && !impact; tick++) {
          const projectile = state.projectiles[0];
          const nextDistance = projectile.distance - projectileSpeed * 0.05;
          const box = projectileGeometry(
            { ...projectile, distance: nextDistance },
            dinosaur,
          ).hitbox;
          const touches =
            box.x <= player.x + player.width &&
            box.x + box.width >= player.x &&
            box.y <= player.y + player.height &&
            box.y + box.height >= player.y;
          state = advanceCombat(state, buffs, 1, 50).combat;
          expect(state.projectiles).toHaveLength(touches ? 0 : 1);
          expect(state.hp).toBe(touches ? 40 : 50);
          if (touches) {
            impact = true;
            expect(nextDistance).toBeGreaterThan(0);
            expect(advanceCombat(state, buffs, 1, 500).combat.hp).toBe(40);
          }
        }
        expect(impact, `dinosaur ${dinosaur}, projectile ${art}`).toBe(true);
      }
    }
  });
});
