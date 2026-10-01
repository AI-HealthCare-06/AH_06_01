# Dino attack motions · 2026-10-01

All files are saved under `frontend/public/assets/battle/` and uploaded to [REXRUN / 21-1 Dino Ranged Attack Motion Asset](https://www.figma.com/design/lCWaAEae4xccaADW0osrLx/REXRUN?node-id=701-591), section `701:591` on page `5:2`. Original sections 10, 20 and 21 are preserved.

| Character / mode | PNG file | Figma image | Reference |
| --- | --- | --- | --- |
| Trex / ranged | DinoTrexRangedAttack.png | 701:598 | TrexIdleSpritesheet4X3Png.png |
| Tricera / ranged | DinoTriceraRangedAttack.png | 701:603 | DinoTriceraIdle.png |
| Raptor / ranged | DinoRaptorRangedAttack.png | 701:609 | RaptorIdleSpritesheet4X31Png.png |
| Stego / ranged | DinoStegoRangedAttack.png | 701:614 | DinoStegoIdle.png |
| Brachio / ranged | DinoBrachioRangedAttack.png | 701:625 | DinoBrachioIdle.png |
| Ptera / melee | DinoPteraMeleeAttack.png | 701:631 | 446-578.png |
| Ptera / ranged, dust removed | DinoPteraRangedAttack.png | 701:620 | 434-578.png (original section 10) |

The built-in `image_gen` tool was used for all seven PNGs, with transparent backgrounds enabled. No fallback CLI or API key was used. Selected outputs were copied into the workspace; generated originals remain at the tool's default save location.

## Generation prompt set

The six new sheets share this specification: match the referenced character's pixel-art identity, proportions, palette and outlines; show eight sequential poses in four columns by two rows; face right; keep the full character visible with consistent scale and a shared foot or hover baseline; release/contact on pose 03; return to the starting posture; use transparent alpha; no labels, dust, smoke, detached particles, projectiles or background. The ground characters stay planted during ranged attacks.

Character-specific instructions:

- Trex: green striped T-Rex, jaw wind-up and open-mouth energy breath, planted feet.
- Tricera: sky-blue Triceratops with cream horns, mouth/horn-drill cast with the blue frill retained, planted feet.
- Raptor: orange striped Raptor, wind-breath jaw action with no melee lunge.
- Stego: lavender Stegosaurus with pink plates, stationary mouth launch facing right, no tail sweep.
- Brachio: teal long-neck Brachiosaurus, leafy breath with a full neck and planted feet.
- Ptera melee: red/orange Pteranodon with yellow wings, physical forward beak thrust and recovery, full wings retained, no breath or projectile.

The dust-removal edit used this prompt verbatim with `434-578.png` as the edit target:

> Edit this exact Pteranodon pixel-art sprite sheet. Preserve the red/orange/yellow character identity and ALL EIGHT flying ranged-attack poses, in the exact same left-to-right order in a single horizontal row (8 columns by 1 row), keeping full wings, feet and beak visible. Remove every grey or white dust cloud, smoke puff, speed streak, trail and detached particle behind the wings/feet from ALL poses. NO DUST, NO SMOKE, NO TRAILS, NO MOTION LINES, NO PROJECTILES, no lettering. Replace black backdrop with fully transparent alpha. Keep character pixel-art rendering and the original pose silhouettes unchanged as closely as possible. This is still the ranged air spear release animation, distinct from a new beak-strike melee motion. Provide a clean transparent PNG spritesheet, 8 poses in 1 row, no clipped silhouette.

## Runtime integration

`battle-assets.ts` chooses melee and ranged PNGs separately. The five ground characters retain their existing melee sheets; Stego keeps its 12-pose tail sweep. Ptera uses its new beak strike for melee and its dust-free existing poses for ranged.

`BattleSprite` calibrates each attack's first opaque body pose to the corresponding IDLE bounds, then uses the same scale throughout that sheet. The horizontal body center and foot/hover anchor match IDLE. A padded render buffer preserves extended poses beyond the actor wrapper. Physical body boxes continue to use stable IDLE dimensions and existing melee movement.

All six characters finish visual recovery at 75% of the attack cycle and animate IDLE until the next attack. Ranged pose 03 and Stego melee pose 06 stay at the existing impact time. Actual cooldowns, damage, buff scaling and physical recovery duration are unchanged. Mouth anchors follow the normalized ranged release poses; all projectile art rotates along its stored mouth-to-target velocity.

`frontend/scripts/index-dino-attack-assets.py` requires NumPy and Pillow. It indexes the eight largest connected silhouettes with alpha >128, in row order (Ptera ranged is one row). It writes source-frame coordinates and authored mouth anchors to `src/design/dino-attack-atlases.json` without modifying the original PNGs. Inspection crops go to ignored `tmp/dino-attack-review/`.

Validation covers both modes for all six characters, normal and +80% attack speed, preserved impact/cooldown/damage, IDLE transition and pause, matching first-pose size/anchors and stable hitboxes, mouth release, and Stego's complete 12-pose contact sequence.
