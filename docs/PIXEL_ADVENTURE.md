# Pixel adventure and device quests

This feature continues the current REXRUN demo on `feature/pixel-adventure-device-quests`, created from the latest `develop` with the existing character-customization feature merged as a prerequisite. No release is created.

## UI and game behavior

- The calendar appears only on Dashboard and follows the selected date's Sunday–Saturday week. Past dates have completion-colored borders: 0%, 20–40%, 60–80%, 100%. Daily quest reset and step queries still use local midnight. Individual daily completion counts are saved; older saves only supply their known all-complete days and last active day's partial count.
- New days start with no completed quests. A day qualifies for the weekly reward when all five quests are completed; five distinct qualifying days within Sunday–Saturday fill the bar. Old sample-day completions are not counted retroactively.
- Combat now follows the three supplied game documents: see [GAME_BALANCE.md](GAME_BALANCE.md) for the tables, assumptions and integration boundaries. Monsters spawn every three seconds, move toward a fixed player position, and take repeated hits based on HP, AD, DEF, range, critical chance and knockback. Hit art does not stun. The simulation continues across routes and reconciles up to 24 offline hours at the full rate.
- A stage has ten waves with 30, 40, 50, 60, 70 + Elite, 70, 80, 90, 100, 100 + Boss opponents. Backgrounds scroll 10% of the full panorama after each wave and change maps after all ten waves; the next stage unlocks at its recommended level, otherwise wave ten repeats. Monster feet are above the grass/soil boundary, and the stage heading explicitly separates STAGE from WAVE.
- Five characters use the supplied eight-frame attack sheets, including the new Pteranodon sheet. Only Stegosaurus retains idle artwork during attacks. Their original artwork and individual motion styles are retained without continuous player travel. Pteranodon plays its four-frame wing sheet between waves and attacks diagonally down-right before returning to its idle flight height. Reduced-motion mode suppresses wing motion, lunges and attack-frame cycling.
- Buff buttons use ATK / DEF / CRT / SPD / GOLD. Their inline panels show the current calculated effect and linked quest. Combat buffs and penalties use the supplied tables; missing measurements are neutral. The HP heart remains removed.
- The stage bar retains the dashboard segmented gauge with muted track and green fill. It counts all kills in the current wave, including its Elite/Boss, with the same width as the game background and no extra spawn/composition caption.
- The EXP bar remains 40% of HP height with gray track/green fill and current/required EXP. Growth starts at Lv.1 with a 100 EXP threshold and successive floored ×1.22 thresholds. Every defeated monster now grants 1 EXP immediately, including failed attempts. Combat kill/level-up GOLD accumulates as a pending wave reward and banks only on clear; defeat discards pending GOLD. Quest EXP/rewards retain their separate rules.
- Cards, controls, progress bars, navigation and text use pixel styling. Korean text uses the local [Galmuri](https://github.com/quiple/galmuri) font (OFL-1.1); English headings retain Press Start 2P.
- Camera access begins only after tapping “카메라 켜기”. Medicine/water prefer the front camera; meals prefer the rear camera. Changing a quest restarts an active stream with the new lens. Sleep is excluded. Preview and capture share a 3:4 portrait crop. The stream stops on capture, hidden page or unmount. Photos remain in the page's memory. Live recognition and server photo verification are not implemented.
- Attacks approach the visible enemy at impact. Pteranodon hovers and flies above the ground. Radar lines are straight with a thicker outer grid outline; point markers remain pixel squares.
- Notices appear at the top safe area; dialogs remain modal. The account page shares the profile avatar, shows available battery/network status without a simulated punch hole, and includes back navigation, a pixel switch and wearable setup guidance.
- Step-connection guidance sits above the quest list. Home prioritizes pending quests across all five types and shows up to four; completed quests fill any remaining slots. Walk/water bars and counts remain next to the title, without redundant completion text.
- Dashboard's period dropdown selects daily, weekly, monthly or yearly sample history. One Report contains health score, dinosaur growth, quest progress, period history, disease risks and weekly predictions. Period changes remount only the report body; the upper score and gauge keep their existing DOM and animation state. The report uses higher-contrast Galmuri pixel text, bordered panels and segmented bars. Its scrollbar is hidden while touch, wheel and keyboard scrolling remain available, retaining the shared navigation position. Risk cards show the actual latest profile registration date, or an unregistered state. Only that date is persisted, not the health inputs.
- The greeting uses [Open-Meteo current weather](https://open-meteo.com/en/docs) after location permission. Coordinates are rounded to two decimals, used for the request and not persisted. Already-granted permission allows refresh on foreground return after 30 minutes; otherwise the user requests weather with the greeting button. Denied location and network errors keep a neutral fallback with retry.

## Original Figma art

The source is [REXRUN](https://www.figma.com/design/lCWaAEae4xccaADW0osrLx/REXRUN?node-id=5-2). This change reads Figma and does not edit it. Local original image files are named by node ID under `frontend/public/assets/battle/`; the mapping lives in `frontend/src/design/battle-assets.ts`.

| Section | Nodes | Use |
| --- | --- | --- |
| 08 — GameStage Background Variants | 258:697, 701, 705, 709, 713, 717 | Six scrolling stage backdrops |
| 09 — Dino Character Assets | 276:699, 702, 705, 709, 712, 715 | Right-facing adventure artwork |
| DINO FACE ASSETS · FLIPPED | 493:579, 582, 592, 585, 589, 595 | Tyrannosaurus, Triceratops, Raptor, Stegosaurus, Pteranodon and Brachiosaurus portraits |
| 10 — Character Attack Motions | 288:700, 290:697, 295:697, 308:697, 434:578 | Triceratops, Tyrannosaurus, Brachiosaurus, Raptor and Pteranodon attack sheets |
| 10 — Character Attack Motions / Walking | 446:578 | Four Pteranodon wing poses |
| 12 — Villain Hit Reactions | 464:581, 586, 591, 596, 601, 606 | Earlier hit assets retained as source references |
| 11 — Villain Character Concepts | 300:700, 705, 710, 715; 313:694, 699 | Earlier concept art retained as source references |
| 14 — Dino Animation Assets | 511:579 | T-Rex/Raptor idle and walk |
| 15 — Ranged Villain Assets | 535:574 | Six ranged idle/hit/attack/projectile sets |
| 16 — Melee Villain Assets | 542:574 | Six melee idle/hit/attack sets |
| Shop / Customize | 336:505, 359:600, 359:689 | 14 HEAD and 12 PET items |

Attack sheets contain eight hand-positioned poses. Explicit frame bounds and connected-component separation preserve whole poses and remove neighboring silhouettes where their horizontal bounds overlap. Frames share scale and baseline. Concept cards' edge-connected white backgrounds and the Pteranodon sheet's black backdrop are removed only during canvas rendering; original assets are unmodified. The Pteranodon walking sheet (446:578) supplies four row-major wing poses, replayed in 640ms. Six updated villain concepts use matching section 12 hit poses for 200ms without changing combat cooldowns. Onboarding retains the existing left-facing artwork.

## Android and iPhone steps

The [Capacitor Health plugin](https://github.com/Cap-go/capacitor-health) reads **only steps**, with an empty write-permission list. Native daily aggregation avoids summing overlapping phone/watch samples. While the app is visible, it refreshes every 30 seconds and on returning to the foreground. A valid current-day reading updates progress and automatically completes the walk quest at 6,000 steps. Stale and invalid snapshots are ignored; repeated readings do not grant repeated quest rewards.

The web build cannot read Health Connect/HealthKit and shows a connection explanation. Native builds contain the actual plugin, permission configuration and API calls. On iOS, denied read permission is intentionally not distinguishable from unavailable records: an empty response is shown as “아직 읽을 수 있는 기록이 없어요”, not a confirmed zero or successful authorization.

The last daily reading (count/source/time), quest completion dates and demo GOLD are stored locally. Health data is not transmitted to a service. “연동 끄기” disables polling; OS permissions can be revoked in Health Connect/Health settings. Logout resets local progress and disables polling. Health risk predictions remain demo data.

### Build and run

```sh
cd frontend
npm ci
npm run native:sync
npm run native:android
# On macOS with Xcode:
npm run native:ios
```

Android uses API 26+ and the installed Health Connect provider. The app manifest removes the health plugin's unrelated health permissions, leaving `READ_STEPS`; the camera is optional. Health Connect may need a connected step data source on the device. iOS has a HealthKit entitlement and usage descriptions; select your Apple signing team in Xcode. `com.rexrun.demo` is the development application ID and can be changed before distribution.

Web builds, browser emulation and mocked adapter tests do not prove physical-device Health Connect/HealthKit integration. Verify on both devices: permission denial/regrant, phone/watch aggregation, midnight rollover, resume sync, 5,999→6,000 auto-completion and no duplicate GOLD. Also verify camera permissions and stream cleanup on both native WebViews. App Store / Play deployment and server photo verification are outside this change.

### Verification on 2026-09-30

- Dependencies were installed using `npm ci` and the committed lockfile. Lint, formatting, all 55 unit tests and the production build pass; the final selected-week history adjustment also passed its 13 related unit cases. The entry chunk retains a size advisory: 531.80 kB, 164.08 kB gzip.
- All 70 Playwright browser cases are verified across the full run and focused reruns. The full run passed 65; five existing expectations needed the new G suffix, accessory tab, longer stage sequence or a clock fast-forward for midnight. A 22-case rerun passed 21, then the stage case passed after asserting its actual idle sprite rather than the start-phase name. Coverage includes all six dinosaurs reaching a 7u target, damage at contact, projectile/debug-box agreement, clear/travel/start timing, HP restoration, kill EXP, deferred GOLD, pause/reload, debug buffs, purchase/equip, selected-date history and navigation bounds.
- The new vault, wallet and date controls fit 320/390/542px browser widths and were visually inspected alongside the centered debug popup and expanded HUD. Existing checks also cover desktop layouts, touch swipes, device chrome, quests, economy, camera, weather and saved profile behavior. Production JavaScript contains no debug overlay or buff-control text.
- Earlier in this feature, `npx cap sync` completed for both platforms and Android `:app:assembleDebug` succeeded; the merged manifest contains only `READ_STEPS` among health permissions. Native builds were not rerun for these web/game changes.
- iOS signing/build and physical-device health/camera testing remain pending because the development host is Windows.

### Main tab and wallet updates

Shop → Character → Home → Camera → Dashboard supports horizontal touch swipes, while forms, dialogs, vertical gestures and screen edges remain independent. Quests remain reachable from Home and the pixel document shortcut in the header. The standalone wallet block is replaced by a GOLD-card conversion modal with minimum/maximum RP controls and no EXP/level fields. GOLD accessory purchases use /shop/customize; owned equipment and free dinosaur styles live on Character. The shop has Recommendation and Customization buttons; six products use the restored 206px rows in a scrollable catalog above navigation. The daily bonus and conversion use matching compact buttons. Added photographs and their licenses are listed in [ASSET_CREDITS.md](ASSET_CREDITS.md).

### Battle geometry and trimmed artwork

Sprite rendering crops each canvas to its nontransparent bounds while retaining a common frame scale and anchor, avoiding animation jitter. Earlier source files remain unchanged; section 14/15/16 animations use compact pixel atlases generated by `frontend/scripts/prepare-battle-assets.py`. The Pteranodon's resting position is slightly above the map midpoint, and the HUD buff toggle displays only its arrow while retaining an accessible name.

`battle-geometry.ts` defines separate body colliders and receiving hitboxes in 354 × 336 design coordinates. Narrow cola, wider food monsters and larger Elite/Boss bodies have separate proportions. Monster sprites and both boxes sit 7 design pixels lower following the latest positioning comment; attack targets automatically follow the shifted hitboxes. Enemy movement respects the body stop boundary as well as the existing melee/ranged stopping distances. These are logical game coordinates, independent of image padding and responsive CSS scaling.

Each attack records its target ID, art and rank. The visual strike approaches that target's current hitbox, including knockback, and returns to the resting anchor; defeated targets use the saved position. Character-specific contact anchors place impact at the saved contact time, mapped to 30% of the pose sequence. Long-range pursuit uses the duration and delayed-hit rules below. Old saved attacks without the new optional fields remain loadable.

The development server adds a DEBUG toggle next to pause. Cyan solid rectangles show colliders and pink dashed rectangles show hitboxes for the player (P) and each monster instance (M + ID). The overlay shares the combat design coordinates and responsive scale, updates as enemies move or disappear, and never intercepts clicks. The separate popup accepts level and close controls. Player boxes remain at the logical resting position while its attack artwork travels. Melee damage and ranged launches use range and timers; launched projectiles apply damage once on their first contact with the fixed player hitbox. The toggle and overlay are removed from production JavaScript. Current character, monster, stage, wave and rank stats are listed in [GAME_BALANCE.md](GAME_BALANCE.md).

Chromium mobile emulation also verified native touch dispatch in both directions between Shop and Character. Physical iOS/Android swipe behavior has not been tested.

### Full-body collision sizing

Both actors now use the nontransparent resting artwork as a 100% hitbox and expand its width/height to 110% about the same center for the collider. Static render-buffer bounds keep attack/hit poses from changing body size. Character x moves from 18 to 8; ground characters and monsters share the y=253 foot anchor while Pteranodon keeps its flight height. Movement and enemy attack range both honor the selected character body contact distance, avoiding melee enemies stopping outside their attack reach. Base HP/AD/DEF growth and cooldown formulas are unchanged. Updated 24-hour comparisons are in GAME_BALANCE.md.

### Debug attack ranges

DEBUG shows a yellow player range ruler/boundary (3 units) and orange monster rulers with effective reach and IN/OUT status. Both rulers start at the simulation's fixed origin (0u at x=68), with equal 1u=30px ticks, two decimal places and a u suffix. A diamond marks each monster's current logical position and a dotted connector identifies its body. Its attack boundary is x=68+effectiveReach×30; the marker reaches that boundary exactly when the shared enemyAttackRange boundary comparison becomes true. This replaces the backward ruler from the sprite container, whose overlap with the player artwork misleadingly suggested a hitbox-based attack check. The second line shows current distance and distance still to travel, or cooldown remaining when IN. Collider contact remains part of effective reach, and combat rules/cooldowns are unchanged. Markers follow approach and knockback, remain visible when paused and disappear with defeated enemies. Browser checks cover common origins/tick spacing at 320/390px, exact contact boundaries, actual HP changes, cooldowns and knockback for ranged/melee/boss enemies. Production JavaScript excludes the debug range UI.

### Mixed units, transitions and customization (2026-09-30)

Ordinary waves contain seven melee and three ranged units per ten. Ranged units stop at 7u reach, attack every 1000ms and only approach again after knockback carries them outside it. Melee retains 500ms attacks. Projectiles travel at 6 logical units/s; shared render/collision geometry removes them and applies damage on their first visible-bounds contact with the fixed player hitbox. Existing HP/AD/DEF and wave counts are preserved; a long-range player lunge delays its next attack until the longer motion finishes. Clear/travel state is saved with combat and advances on the same fixed clock, including pause/offline reconciliation. Wave clear lasts 1000ms, stage clear 1600ms. After clear disappears, the panorama moves 10% over 3000ms, crossfading maps on stage changes. Arrival restores full HP and shows the next wave's start banner for 1000ms before any spawn. Both banners play idle artwork; only travel plays walking.

Figma 14 (`511:579`) supplies T-Rex and Raptor idle/walk sheets; no equivalent new sheets exist there for the other four dinosaurs. Melee units use section 16 (`542:574`) and ranged units section 15 (`535:574`). All six appearances have dedicated hit and eight-frame attack assets; ranged units additionally use matching projectile images. Large originals are cropped, alpha-cleaned and resampled to the battle buffer resolution; `animation-atlases.json` records frame rectangles and reference body bounds. The reproducible preparation script accepts original Figma fill PNGs as input.

The separate `/shop/customize` route follows `Shop / Customize / 390×882` (`336:505`): 14 HEAD items from `359:600`, 12 PET items from `359:689`, category filters and the Figma GOLD prices. Purchase/ownership/equipment persist locally. Character retains free character styles and now equips purchased items; equipped artwork appears on the character preview and battle actor. No combat stats or server balances change.

The compact dashboard selector sits right of the title with its label above it; disease risk precedes the trend for every period. The desktop preview baseline is 390×844 (approximately 19.5:9); real phones use their available viewport. Health scores and predictions remain demo data.

The Home dark panel follows the full content height through the radar/quest cards when scrolled. Recovery copy uses a padded countdown such as `05초 후 재시작`, retaining the 10-second revival policy.

### Long-range pursuit and debug popup

The nearest living unit is selected first (instance ID breaks ties). When all living units are ranged, the player may lunge outside its normal 3u reach. Duration scales by distance/3 and rounds up to a 50ms tick; the hit occurs at a saved contact time, with no early damage or duplicate reward after reload. The return animation completes before the next attack or clear effect. Projectiles are 40% wider/taller (39.2×29.4 design px) and use the same enlarged visible bounds for first-contact collision and the purple debug rectangles.

The development-only settings popup opens above DEBUG and horizontally centered in the viewport, tracks scroll/resize, and stays within 320/390/542px viewports. It lists every living monster’s HP, AD, effective reach, attack interval, speed and cooldown. Level controls remain available; Escape/close returns focus to DEBUG and removes both popup and overlays. Five numerical buff controls change actual attack bonus, incoming-damage reduction, critical chance, attack speed and GOLD multiplier without marking quests. Overrides last only for the current run, can be restored to real quest values, and are omitted from saved game JSON. The expanded HUD lists attack, defense/damage reduction, extra GOLD and critical chance above compact rounded buff buttons.

### Character vault, wallet and dated reports

Character follows Figma `18 — Character Select / Change Dino`, `566:574`, adapted to the shared pixel shell: six face roster buttons, selected hero with previous/next controls, skin preview and explicit apply action. Skins and owned accessories use separate tabs; the inventory query string preserves the tab on reload and links from the shop. Existing styles/ownership persist. The four featured styles follow the design; five older styles remain available. Roster PNGs and the hero are byte-identical to already bundled assets; the three filtered skin thumbnail layers are exported locally with source mappings in ASSET_CREDITS.md. The existing five-tab navigation and device chrome are retained.

Shop's wallet row is coin icon / GOLD / actual value with G suffix / conversion, with its two-line explanation and daily free-GOLD action below. Date controls on Dashboard support a reference date for day/week/month/year and an explicit start/end range. Future/invalid ranges are rejected or clamped. The calendar, selected-day quest summary and selected-week completion count read saved records; trend labels follow the selected interval, while health scores/risks remain labeled demo data. Score animation stays mounted during period/date changes.
