# Dino attack motions · 2026-10-01

All files are saved under `frontend/public/assets/battle/` and uploaded to [REXRUN / 21-1 Dino Ranged Attack Motion Asset](https://www.figma.com/design/lCWaAEae4xccaADW0osrLx/REXRUN?node-id=701-591), section `701:591` on page `5:2`. Original sections 10, 20 and 21 are preserved.

| Character / mode | PNG file | Figma image | Reference |
| --- | --- | --- | --- |
| Trex / ranged | DinoTrexRangedAttack.png | 701:598 | TrexIdleSpritesheet4X3Png.png |
| Tricera / ranged | DinoTriceraHornRangedAttack.png | 701:603 | DinoTriceraIdle.png; previous DinoTriceraRangedAttack.png |
| Raptor / ranged | DinoRaptorClawRangedAttack.png | 701:609 | RaptorIdleSpritesheet4X31Png.png; previous DinoRaptorRangedAttack.png |
| Stego / ranged | DinoStegoRangedAttack.png | 701:614 | DinoStegoIdle.png |
| Brachio / ranged | DinoBrachioRangedAttack.png | 701:625 | DinoBrachioIdle.png |
| Ptera / melee | DinoPteraMeleeAttack.png | 701:631 | 446-578.png |
| Ptera / ranged, dust removed | DinoPteraRangedAttack.png | 701:620 | 434-578.png (original section 10) |

The built-in `image_gen` tool was used for all seven PNGs, with transparent backgrounds enabled. No fallback CLI or API key was used. Selected outputs were copied into the workspace; generated originals remain at the tool's default save location.

## Generation prompt set

The six new sheets share this specification: match the referenced character's pixel-art identity, proportions, palette and outlines; show eight sequential poses in four columns by two rows; face right; keep the full character visible with consistent scale and a shared foot or hover baseline; release/contact on pose 03; return to the starting posture; use transparent alpha; no labels, dust, smoke, detached particles, projectiles or background. The ground characters stay planted during ranged attacks.

Character-specific instructions:

- Trex: green striped T-Rex, jaw wind-up and open-mouth energy breath, planted feet.
- Tricera: sky-blue Triceratops with cream horns, a closed-mouth brow-horn cast with the blue frill retained and planted feet. The earlier mouth-cast PNG is retained as a reference.
- Raptor: orange striped Raptor, foreclaw wind cast with a closed mouth and no melee lunge; release from the forward claw tips on pose 03.
- Stego: lavender Stegosaurus with pink plates, stationary mouth launch facing right, no tail sweep.
- Brachio: teal long-neck Brachiosaurus, leafy breath with a full neck and planted feet.
- Ptera melee: red/orange Pteranodon with yellow wings, physical forward beak thrust and recovery, full wings retained, no breath or projectile.

The dust-removal edit used this prompt verbatim with `434-578.png` as the edit target:

> Edit this exact Pteranodon pixel-art sprite sheet. Preserve the red/orange/yellow character identity and ALL EIGHT flying ranged-attack poses, in the exact same left-to-right order in a single horizontal row (8 columns by 1 row), keeping full wings, feet and beak visible. Remove every grey or white dust cloud, smoke puff, speed streak, trail and detached particle behind the wings/feet from ALL poses. NO DUST, NO SMOKE, NO TRAILS, NO MOTION LINES, NO PROJECTILES, no lettering. Replace black backdrop with fully transparent alpha. Keep character pixel-art rendering and the original pose silhouettes unchanged as closely as possible. This is still the ranged air spear release animation, distinct from a new beak-strike melee motion. Provide a clean transparent PNG spritesheet, 8 poses in 1 row, no clipped silhouette.

## Runtime integration

`battle-assets.ts` chooses melee and ranged PNGs separately. The five ground characters retain their existing melee sheets; Stego keeps its 12-pose tail sweep. Ptera uses its new beak strike for melee and its dust-free existing poses for ranged.

`BattleSprite` calibrates each attack's first opaque body pose to the corresponding IDLE bounds, then uses the same scale throughout that sheet. The horizontal body center and foot/hover anchor match IDLE. A padded render buffer preserves extended poses beyond the actor wrapper. Physical body boxes continue to use stable IDLE dimensions and existing melee movement.

All six characters finish visual recovery at 75% of the attack cycle and animate IDLE until the next attack. Ranged pose 03 and Stego melee pose 06 stay at the existing impact time. Actual cooldowns, damage, buff scaling and physical recovery duration are unchanged. Release anchors follow the normalized ranged poses: Tricera uses its forward brow-horn tip and Raptor its foreclaws. The other four use their mouths with the projectile center shifted 4 design px to the right of the lip, independent of sprite size. All projectile art rotates along the stored release-to-target velocity.

`frontend/scripts/index-dino-attack-assets.py` requires NumPy and Pillow. It indexes the eight largest connected silhouettes with alpha >128, in row order (Ptera ranged is one row). It writes source-frame coordinates and authored release anchors to `src/design/dino-attack-atlases.json` without modifying the original PNGs. Inspection crops go to ignored `tmp/dino-attack-review/`.

Validation covers both modes for all six characters, normal and +80% attack speed, preserved impact/cooldown/damage, IDLE transition and pause, matching first-pose size/anchors and stable hitboxes, horn/claw/mouth release with the forward mouth offset, and Stego's complete 12-pose contact sequence.

## Raptor foreclaw revision

The built-in `image_gen` edit used the prior ranged PNG as the edit target and IDLE as a supporting character reference. The new transparent sheet is saved as `DinoRaptorClawRangedAttack.png`; the previous wind-breath file is retained as a source record. Figma image `701:609` and the runtime now use the foreclaw version. Pose 03 extends both forearms in a diagonal swipe and casts the existing wind projectile from the forward claw tips. Its release point is [159, 91] in IDLE-aligned 160×120 coordinates. The mouth stays closed, the feet stay planted, and there are no dust effects.

Prompt used verbatim:

> Edit target image 1, the orange Raptor ranged-attack spritesheet. Image 2 is supporting IDLE character reference only. Keep the same orange striped pixel-art Raptor identity, palette, large head, tail, feet and crisp outlines. Replace ALL mouth-breath gestures with a distinct foreclaw-swipe ranged casting animation. The mouth stays CLOSED and the head remains near its idle angle in every pose. Eight sequential full-body poses, strictly 4 columns x 2 rows, facing right: 01 idle-sized ready stance; 02 forearms pull back and raise claws for wind-up; 03 RELEASE pose, visibly swing BOTH long foreclaws forward toward screen-right in a sharp diagonal downward swipe, claws extended ahead of the chest; 04 follow-through with forearms forward and lowered; 05 recoil; 06 arms pull back; 07 recover; 08 return to idle. The hand/claw motion must be obvious even at small mobile-game size. Feet remain planted, NO body lunge, identical body/head scale across poses, shared ground baseline. This gesture sends a separate wind-blade projectile from the FRONT CLAW TIPS on pose 03; do not draw the projectile inside this sprite sheet. NO mouth attack, NO roar, NO dust, NO smoke, NO detached effects, NO motion trails, NO letters, NO background. Preserve genuine transparent alpha and full silhouettes without clipping.

## Tricera brow-horn revision

The built-in `image_gen` edit used the previous Tricera ranged sheet as the target and IDLE as the supporting character reference. The transparent output is saved as `DinoTriceraHornRangedAttack.png`; the prior mouth-cast sheet remains in the repository. Figma card `701:601`, image `701:603` and the runtime now use the horn version. Pose 03 lowers the head and points the visible front brow horn forward, with the mouth closed and feet planted. Its authored release anchor is [170, 57] in IDLE-aligned 160×120 coordinates, just at the extended horn tip. This extended pose can render beyond the stable IDLE body box.

Prompt used verbatim:

> Edit target image 1, the blue Triceratops ranged-attack spritesheet. Image 2 is supporting IDLE character reference only. Preserve this exact sky-blue squat Triceratops identity, cream three horns, striped blue frill, pink underside, short tail, pixel-art texture and dark outlines. Replace the mouth-breath motion with a distinct HORN ranged casting animation, not a melee charge. The mouth remains CLOSED in ALL poses. Eight sequential full-body poses strictly in 4 columns by 2 rows, facing right: 01 idle-sized ready stance; 02 head and frill tilt back slightly to charge the brow horns; 03 RELEASE pose, tilt the head/frill forward and down so the front visible BROW HORN points diagonally toward screen-right and its tip is exposed ahead of the face, with a firm planted stance; 04 brief head follow-through while horns stay pointed forward; 05 recoil with head lifting; 06 ease back; 07 settle; 08 original idle stance. Make the head/horn gesture clear at small mobile-game size. The existing separate horn-shaped projectile will originate from the FRONT BROW HORN TIP on pose 03, so do NOT draw the projectile or any effects in the sheet. Feet remain in place, NO body lunge, same full-body size and ground baseline in each row, full silhouette visible without clipping. No open mouth, no roar, no breath, no dust, no smoke, no detached particles, no trails, no letters, no background. Genuine transparent alpha. Keep exactly eight clean disconnected character silhouettes.
