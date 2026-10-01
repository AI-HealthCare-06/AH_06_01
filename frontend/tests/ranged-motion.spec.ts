import { expect, test } from "@playwright/test";

const dinosaurMotions = [
  ["Trex", "TrexIdleSpritesheet4X3Png", "290-697", "DinoTrexRangedAttack"],
  ["Tricera", "DinoTriceraIdle", "288-700", "DinoTriceraRangedAttack"],
  ["Raptor", "RaptorIdleSpritesheet4X31Png", "308-697", "DinoRaptorClawRangedAttack"],
  ["Stego", "DinoStegoIdle", "DinoStegoTailSweepV2", "DinoStegoRangedAttack"],
  ["Ptera", "446-578", "DinoPteraMeleeAttack", "DinoPteraRangedAttack"],
  ["Brachio", "DinoBrachioIdle", "295-697", "DinoBrachioRangedAttack"],
];
for (let dinosaur = 0; dinosaur < dinosaurMotions.length; dinosaur++)
  for (const ranged of [true, false])
    for (const asBonus of [0, 0.8])
      test(`${dinosaurMotions[dinosaur][0]} plays IDLE between ${ranged ? "ranged" : "melee"} attacks at AS +${asBonus * 100}%`, async ({
        page,
      }) => {
        await page.clock.install();
        await page.clock.pauseAt(new Date());
        await page.goto("/home");
        await page.evaluate(
          async ({ ranged, asBonus, dinosaur }) => {
            const storePath = "/src/stores/game-store.ts";
            const battlePath = "/src/domain/battle.ts";
            const rangePath = "/src/domain/battle-range.ts";
            const { useGameStore } = await import(storePath);
            const { initialCombat } = await import(battlePath);
            const { enemyAttackRange } = await import(rangePath);
            const { game } = useGameStore.getState();
            const enemy = {
              id: 42,
              art: 0,
              rank: "normal" as const,
              ranged,
              distance: 7,
              hp: 1000,
              maxHp: 1000,
              ad: 0,
              attackIn: 5000,
              hitAt: -1000,
            };
            if (!ranged) enemy.distance = enemyAttackRange(enemy, dinosaur);
            useGameStore.setState({
              paused: false,
              game: {
                ...game,
                dinosaur,
                battlePaused: false,
                battleUpdatedAt: Date.now(),
                debugBuffs: { asBonus, crt: 0, adBonus: 0 },
                combat: { ...initialCombat(), spawnIn: 5000, spawned: 1, enemies: [enemy] },
              },
            });
          },
          { ranged, asBonus, dinosaur },
        );
        const player = page.locator(".battle-dinosaur"),
          canvas = player.locator("canvas");
        await page.clock.runFor(50);
        await expect(player).toHaveAttribute("data-attack-mode", ranged ? "ranged" : "melee");
        const first = await page.evaluate(async () => {
          const path = "/src/stores/game-store.ts";
          const { useGameStore } = await import(path);
          return useGameStore.getState().game.combat.lastAttack!;
        });
        await page.clock.runFor(first.impactAt! - first.time);
        const source = `/assets/battle/${dinosaurMotions[dinosaur][ranged ? 3 : 2]}.png`;
        await expect(canvas).toHaveAttribute("data-rendered-src", source);
        await expect(canvas).toHaveAttribute(
          "data-rendered-frame",
          String(!ranged && dinosaur === 3 ? 5 : 2),
        );
        const idleAt = first.time + Math.ceil((first.duration! * 0.75) / 50) * 50;
        await page.clock.runFor(idleAt - first.impactAt!);
        await expect(player).toHaveAttribute("data-animation", "idle");
        await expect(player).toHaveAttribute("data-attacking", "false");
        await expect(canvas).toHaveAttribute(
          "data-rendered-src",
          `/assets/battle/${dinosaurMotions[dinosaur][1]}.png`,
        );
        await page.getByRole("button", { name: "모험 일시정지", exact: true }).click();
        const frame = await canvas.getAttribute("data-frame");
        await page.clock.runFor(1000);
        await expect(canvas).toHaveAttribute("data-frame", frame!);
        await page.locator(".pixel-battle").screenshot({
          path: `test-results/${dinosaurMotions[dinosaur][0]}-idle-${ranged ? "ranged" : "melee"}-${asBonus}.png`,
        });
        await page.getByRole("button", { name: "모험 재개", exact: true }).click();
        const nextAt = first.time + Math.ceil(500 / (1 + asBonus) / 50) * 50;
        await page.clock.runFor(nextAt - idleAt);
        await expect(player).toHaveAttribute("data-animation", "attack");
        const next = await page.evaluate(async () => {
          const path = "/src/stores/game-store.ts";
          const { useGameStore } = await import(path);
          return useGameStore.getState().game.combat.lastAttack!;
        });
        await expect(canvas).toHaveAttribute(
          "data-rendered-src",
          `/assets/battle/${dinosaurMotions[dinosaur][next.mode === "ranged" ? 3 : 2]}.png`,
        );
        expect(next.time).toBe(nextAt);
        expect(first.damage).toBe(ranged ? 20 : 23);
        expect(next.damage).toBe(next.mode === "melee" ? 23 : 20);
        expect(next.impactAt! - next.time).toBe(first.impactAt! - first.time);
      });

test("six dinosaurs share IDLE body size and foot or hover anchors in both attack modes", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  const canvas = page.locator(".battle-dinosaur canvas");
  for (let dinosaur = 0; dinosaur < 6; dinosaur++) {
    const sizes = [];
    for (const mode of ["idle", "melee", "ranged"] as const) {
      await page.evaluate(
        async ({ dinosaur, mode }) => {
          const path = "/src/stores/game-store.ts";
          const battlePath = "/src/domain/battle.ts";
          const { useGameStore } = await import(path);
          const { initialCombat } = await import(battlePath);
          const { game } = useGameStore.getState();
          useGameStore.setState({
            paused: true,
            game: {
              ...game,
              dinosaur,
              battlePaused: true,
              combat: {
                ...initialCombat(),
                lastAttack:
                  mode === "idle"
                    ? null
                    : {
                        time: 0,
                        mode,
                        duration: 500,
                        impactAt: 150,
                        resolved: true,
                        distance: 7,
                        damage: 20,
                        critical: false,
                      },
              },
            },
          });
        },
        { dinosaur, mode },
      );
      const source = `/assets/battle/${dinosaurMotions[dinosaur][mode === "idle" ? 1 : mode === "melee" ? 2 : 3]}.png`;
      await expect(canvas).toHaveAttribute("data-rendered-src", source);
      await expect(canvas).toHaveAttribute("data-rendered-frame", "0");
      if (mode !== "idle") await expect(canvas).toHaveAttribute("data-size-reference", "idle");
      sizes.push(
        await canvas.evaluate((node) => {
          const canvas = node as HTMLCanvasElement;
          const pixels = canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          let left = canvas.width,
            top = canvas.height,
            right = -1,
            bottom = -1;
          for (let y = 0; y < canvas.height; y++)
            for (let x = 0; x < canvas.width; x++)
              if (pixels[(y * canvas.width + x) * 4 + 3] > 128) {
                left = Math.min(left, x);
                top = Math.min(top, y);
                right = Math.max(right, x);
                bottom = Math.max(bottom, y);
              }
          const wrap = canvas.parentElement!;
          const scaleX = parseFloat(wrap.style.width) / 160,
            scaleY = parseFloat(wrap.style.height) / 120;
          return {
            width: (right - left + 1) * scaleX,
            height: (bottom - top + 1) * scaleY,
            centerX: (parseFloat(canvas.style.left) * 1.6 + (left + right + 1) / 2) * scaleX,
            bottom: (parseFloat(canvas.style.top) * 1.2 + bottom + 1) * scaleY,
            hitbox: JSON.parse(wrap.getAttribute("data-hitbox")!),
          };
        }),
      );
      if (mode !== "idle")
        await page.locator(".pixel-battle").screenshot({
          path: `test-results/${dinosaurMotions[dinosaur][0]}-${mode}-idle-size.png`,
        });
    }
    for (const attack of sizes.slice(1)) {
      for (const key of ["width", "height", "centerX", "bottom"] as const)
        expect(Math.abs(attack[key] - sizes[0][key])).toBeLessThan(1.3);
      expect(attack.hitbox).toEqual(sizes[0].hitbox);
    }
  }
});

test("Stego tail sweep renders all twelve poses, contacts on pose six, and moves body boxes together", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  const times = [14, 41, 68, 95, 123, 150, 185, 219, 254, 288, 323, 358];
  const hashes = new Set<number>();
  let rest: {
    x: number;
    y: number;
    hit: { x: number; y: number };
    collider: { x: number; y: number };
  };
  const player = page.locator(".battle-dinosaur"),
    canvas = player.locator("canvas");
  for (const [frame, clock] of [-1, ...times].entries()) {
    await page.evaluate(async (clock) => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      const { game } = useGameStore.getState();
      useGameStore.setState({
        paused: true,
        game: {
          ...game,
          dinosaur: 3,
          battlePaused: true,
          combat: {
            ...game.combat,
            hp: 50,
            clock: Math.max(0, clock),
            transition: null,
            recovery: 0,
            enemies: [],
            projectiles: [],
            playerProjectiles: [],
            lastAttack:
              clock < 0
                ? null
                : {
                    time: 0,
                    mode: "melee",
                    duration: 500,
                    impactAt: 150,
                    offsetX: 12,
                    offsetY: -4,
                    resolved: true,
                    distance: 2,
                    damage: 23,
                    critical: false,
                  },
          },
        },
      });
    }, clock);
    const position = await player.evaluate((node) => ({
      x: parseFloat((node as HTMLElement).style.left),
      y: parseFloat((node as HTMLElement).style.top),
      hit: JSON.parse(node.getAttribute("data-hitbox")!),
      collider: JSON.parse(node.getAttribute("data-collider")!),
    }));
    if (clock < 0) {
      rest = position;
      continue;
    }
    await expect(canvas).toHaveAttribute("data-src", "/assets/battle/DinoStegoTailSweepV2.png");
    await expect(canvas).toHaveAttribute("data-frame", String(frame - 1));
    await expect(canvas).toHaveAttribute("data-rendered-frame", String(frame - 1));
    await expect
      .poll(() =>
        canvas.evaluate((node) => {
          const image = (node as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(
              0,
              0,
              (node as HTMLCanvasElement).width,
              (node as HTMLCanvasElement).height,
            );
          return Array.from(image.data).filter((v, i) => i % 4 === 3 && v > 0).length;
        }),
      )
      .toBeGreaterThan(1000);
    for (const axis of ["x", "y"] as const) {
      const delta = position[axis] - rest![axis];
      // Browsers serialize CSS pixel offsets with three decimal places.
      expect(position.hit[axis] - rest!.hit[axis]).toBeCloseTo(delta, 2);
      expect(position.collider[axis] - rest!.collider[axis]).toBeCloseTo(delta, 2);
    }
    if (clock === 150) {
      expect(position.x - rest!.x).toBeCloseTo(12, 5);
      expect(position.y - rest!.y).toBeCloseTo(-4, 5);
      await page
        .locator(".pixel-battle")
        .screenshot({ path: "test-results/stego-tail-sweep-contact.png" });
    }
    hashes.add(
      await canvas.evaluate((node) => {
        const pixels = (node as HTMLCanvasElement)
          .getContext("2d")!
          .getImageData(
            0,
            0,
            (node as HTMLCanvasElement).width,
            (node as HTMLCanvasElement).height,
          ).data;
        let hash = 2166136261;
        for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
        return hash;
      }),
    );
  }
  expect(hashes.size).toBe(12);
});

test("six dinosaurs use authored idle, walk and attack poses; Ptera shares idle/walk", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-30T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T00:01:00Z"));
  await page.goto("/home");
  const sources = [
    ["TrexIdleSpritesheet4X3Png", "TrexWalkSpritesheet4X4Png", "DinoTrexRangedAttack"],
    ["DinoTriceraIdle", "DinoTriceraWalk", "DinoTriceraRangedAttack"],
    ["RaptorIdleSpritesheet4X31Png", "RaptorWalkSpritesheet4X4Png", "DinoRaptorClawRangedAttack"],
    ["DinoStegoIdle", "DinoStegoWalk", "DinoStegoRangedAttack"],
    ["446-578", "446-578", "DinoPteraRangedAttack"],
    ["DinoBrachioIdle", "DinoBrachioWalk", "DinoBrachioRangedAttack"],
  ];
  for (let dinosaur = 0; dinosaur < 6; dinosaur++)
    for (let mode = 0; mode < 3; mode++) {
      await page.evaluate(
        async ({ dinosaur, mode }) => {
          const path = "/src/stores/game-store.ts";
          const { useGameStore } = await import(path);
          const { game } = useGameStore.getState();
          useGameStore.setState({
            paused: false,
            game: {
              ...game,
              dinosaur,
              battlePaused: false,
              combat: {
                ...game.combat,
                hp: 50,
                clock: 150,
                spawnIn: 5000,
                spawned: 1,
                recovery: 0,
                enemies: [],
                projectiles: [],
                playerProjectiles: [],
                transition:
                  mode === 1
                    ? { kind: "wave", elapsed: 1500, arrived: false, fromStage: 1, fromWave: 1 }
                    : null,
                lastAttack:
                  mode === 2
                    ? {
                        time: 0,
                        mode: "ranged",
                        duration: 500,
                        impactAt: 150,
                        resolved: true,
                        distance: 7,
                        damage: 20,
                        critical: false,
                      }
                    : null,
              },
            },
          });
        },
        { dinosaur, mode },
      );
      const canvas = page.locator(".battle-dinosaur canvas");
      await expect(canvas).toHaveAttribute(
        "data-rendered-src",
        `/assets/battle/${sources[dinosaur][mode]}.png`,
      );
      await expect
        .poll(() =>
          canvas.evaluate(
            (node) =>
              Array.from(
                (node as HTMLCanvasElement)
                  .getContext("2d")!
                  .getImageData(
                    0,
                    0,
                    (node as HTMLCanvasElement).width,
                    (node as HTMLCanvasElement).height,
                  ).data,
              ).filter((v, i) => i % 4 === 3 && v > 0).length,
          ),
        )
        .toBeGreaterThan(100);
      if (mode === 0) {
        const frame = await canvas.getAttribute("data-frame");
        await page.clock.runFor(180);
        await expect(canvas).not.toHaveAttribute("data-frame", frame!);
      }
      if (mode === 2)
        await page
          .locator(".pixel-battle")
          .screenshot({ path: `test-results/dino-motion-${dinosaur}.png` });
    }
});

test("all twelve villain walk sheets animate during approach with compact body-centered HP bars", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-30T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T00:01:00Z"));
  await page.goto("/home");
  const names = [
    "DarkCola",
    "HardCandy",
    "SmokyMarshmallow",
    "RottenBurger",
    "ArchmagePop",
    "DrFireball",
  ];
  for (const ranged of [false, true])
    for (let art = 0; art < 6; art++) {
      await page.evaluate(
        async ({ art, ranged }) => {
          const path = "/src/stores/game-store.ts";
          const { useGameStore } = await import(path);
          const { game } = useGameStore.getState();
          useGameStore.setState({
            paused: false,
            game: {
              ...game,
              battlePaused: false,
              dinosaur: 3,
              combat: {
                ...game.combat,
                clock: 0,
                hp: 50,
                spawned: 1,
                spawnIn: 5000,
                attackIn: 5000,
                lastAttack: null,
                transition: null,
                recovery: 0,
                projectiles: [],
                playerProjectiles: [],
                enemies: [
                  {
                    id: 1,
                    art,
                    ranged,
                    rank: "normal",
                    distance: 8,
                    hp: 77,
                    maxHp: 77,
                    ad: 0,
                    attackIn: 5000,
                    hitAt: -1000,
                  },
                ],
              },
            },
          });
        },
        { art, ranged },
      );
      const enemy = page.locator(".battle-enemy"),
        canvas = enemy.locator("canvas");
      await expect(canvas).toHaveAttribute(
        "data-src",
        `/assets/battle/${ranged ? "Ranged" : "Melee"}${names[art]}Walk.png`,
      );
      await expect(canvas).toHaveAttribute("data-frame", "0");
      await page.clock.runFor(150);
      await expect(canvas).toHaveAttribute("data-frame", "1");
      const sizes = await enemy.evaluate((node) => {
        const label = node.querySelector(".enemy-status")! as HTMLElement;
        const hp = node.querySelector(".enemy-hp")!;
        const hit = JSON.parse(node.getAttribute("data-hitbox")!);
        const scale = node.closest(".design-canvas-inner")!.getBoundingClientRect().width / 354;
        const bar = hp.getBoundingClientRect(),
          wrap = label.getBoundingClientRect();
        return {
          width: bar.width / scale,
          height: bar.height / scale,
          centerOffset: (bar.x + bar.width / 2 - wrap.x - wrap.width / 2) / scale,
          hitWidth: hit.width,
        };
      });
      expect(sizes.height).toBeCloseTo(3, 1);
      expect(sizes.width).toBeCloseTo(Math.max(58, sizes.hitWidth + 8) - 10, 1);
      expect(sizes.centerOffset).toBeCloseTo(0, 1);
      await page.locator(".pixel-battle").screenshot({
        path: `test-results/villain-walk-${ranged ? "ranged" : "melee"}-${art}.png`,
      });
    }
});
