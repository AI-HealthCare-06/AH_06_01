# Pixel adventure and device quests

This feature continues the current REXRUN demo on `feature/pixel-adventure-device-quests`, created from the latest `develop` with the existing character-customization feature merged as a prerequisite. No release is created.

## UI and game behavior

- The calendar uses the device's local date, Sunday through Saturday. Daily quest reset and step queries use the same local midnight boundary.
- New days start with no completed quests. A day qualifies for the weekly reward when all five quests are completed; five distinct qualifying days within Sunday–Saturday fill the bar. Old sample-day completions are not counted retroactively.
- One randomly selected enemy appears per encounter. Attack → defeat → coin drop → movement → next enemy runs only while the Home screen is visible and unpaused. Each completed encounter grants 10 demo coins once (12 with the water buff).
- Worlds contain ten substages: `1-1` through `1-10`, then `2-1`. The background changes only on a world transition; the six backgrounds cycle without resetting the world counter. Targets start at 10 defeats and increase by one per substage: 10, 11, …, 19, 20. Existing lifetime defeats are retained and mapped to this progression. The bar displays a full substage during travel before advancing.
- Five characters use the supplied eight-frame attack sheets, including the new Pteranodon sheet. Only Stegosaurus retains idle artwork during attacks. All six have distinct travel animations. Pteranodon flaps its near wing independently of the body and attacks diagonally down-right before returning to flight height. Reduced-motion mode suppresses wing motion, lunges and attack-frame cycling.
- Five quest buffs below the HP bar activate from today's completed quests: medicine adds 20 max HP, meal adds 15% attack speed, walk adds 20% movement speed, water adds 2 coins per defeat, and sleep adds 40 max HP. These are demo game effects; they reset with the daily quest state. The HP heart is removed.
- The stage bar uses the dashboard's segmented gauge style, with a muted track and green fill. The egg, flag and separate milestone dots are replaced by the continuous segmented track; defeat counts and stage rules are unchanged.
- The EXP bar sits below HP at 40% of its height, with a gray background, green progress and an `EXP 000/300` label. Quest completion grants the advertised EXP once, including device-triggered walk completion. EXP persists across dates and reloads. The demo continues from Lv.12 and currently levels up every 300 EXP, carrying surplus EXP forward; Home, My Page and the buff screen share the same level. Legacy saves credit only known real quest completions from their stored day, not unrecorded historical or sample activity.
- Cards, controls, progress bars, navigation and text use pixel styling. Korean text uses the local [Galmuri](https://github.com/quiple/galmuri) font (OFL-1.1); English headings retain Press Start 2P.
- Camera access begins only after tapping “카메라 켜기”. Medicine/water prefer the front camera; meals prefer the rear camera. Changing a quest restarts an active stream with the new lens. Sleep is excluded. Preview and capture share a 3:4 portrait crop. The stream stops on capture, hidden page or unmount. Photos remain in the page's memory. Live recognition and server photo verification are not implemented.
- Attacks approach the visible enemy at impact. Pteranodon hovers and flies above the ground. Radar lines are straight with a thicker outer grid outline; point markers remain pixel squares.
- Notices appear at the top safe area; dialogs remain modal. The account page shares the profile avatar, shows available battery/network status without a simulated punch hole, and includes back navigation, a pixel switch and wearable setup guidance.
- Step-connection guidance sits above the quest list. Home prioritizes pending quests across all five types and shows up to four; completed quests fill any remaining slots. Walk/water bars and counts remain next to the title, without redundant completion text.
- Dashboard radio controls switch between weekly prediction and monthly/yearly sample history. Growth details sit directly below the score. Risk cards show the actual latest profile registration date, or an unregistered state. Only that date is persisted, not the health inputs. History and predictions remain labeled demo data.
- The greeting uses [Open-Meteo current weather](https://open-meteo.com/en/docs) after location permission. Coordinates are rounded to two decimals, used for the request and not persisted. Already-granted permission allows refresh on foreground return after 30 minutes; otherwise the user requests weather with the greeting button. Denied location and network errors keep a neutral fallback with retry.

## Original Figma art

The source is [REXRUN](https://www.figma.com/design/lCWaAEae4xccaADW0osrLx/REXRUN?node-id=5-2). This change reads Figma and does not edit it. Local original image files are named by node ID under `frontend/public/assets/battle/`; the mapping lives in `frontend/src/design/battle-assets.ts`.

| Section | Nodes | Use |
| --- | --- | --- |
| 08 — GameStage Background Variants | 258:697, 701, 705, 709, 713, 717 | Six scrolling stage backdrops |
| 09 — Dino Character Assets | 276:699, 702, 705, 709, 712, 715 | Right-facing adventure and portrait artwork |
| 10 — Character Attack Motions | 288:700, 290:697, 295:697, 308:697, 434:578 | Triceratops, Tyrannosaurus, Brachiosaurus, Raptor and Pteranodon attack sheets |
| 11 — Villain Character Concepts | 300:700, 705, 710, 715; 313:694, 699 | Six random opponents |

Attack sheets contain eight hand-positioned poses. Explicit frame bounds and connected-component separation preserve whole poses and remove neighboring silhouettes where their horizontal bounds overlap. Frames share scale and baseline. Concept cards' edge-connected white backgrounds and the Pteranodon sheet's black backdrop are removed only during canvas rendering; original assets are unmodified. The flight wing is hinged from the resting pose at render time. Onboarding retains the existing left-facing artwork.

## Android and iPhone steps

The [Capacitor Health plugin](https://github.com/Cap-go/capacitor-health) reads **only steps**, with an empty write-permission list. Native daily aggregation avoids summing overlapping phone/watch samples. While the app is visible, it refreshes every 30 seconds and on returning to the foreground. A valid current-day reading updates progress and automatically completes the walk quest at 6,000 steps. Stale and invalid snapshots are ignored; repeated readings do not grant repeated quest rewards.

The web build cannot read Health Connect/HealthKit and shows a connection explanation. Native builds contain the actual plugin, permission configuration and API calls. On iOS, denied read permission is intentionally not distinguishable from unavailable records: an empty response is shown as “아직 읽을 수 있는 기록이 없어요”, not a confirmed zero or successful authorization.

The last daily reading (count/source/time), quest completion dates and demo coins are stored locally. Health data is not transmitted to a service. “연동 끄기” disables polling; OS permissions can be revoked in Health Connect/Health settings. Logout resets local progress and disables polling. Health risk predictions remain demo data.

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

Web builds, browser emulation and mocked adapter tests do not prove physical-device Health Connect/HealthKit integration. Verify on both devices: permission denial/regrant, phone/watch aggregation, midnight rollover, resume sync, 5,999→6,000 auto-completion and no duplicate coins. Also verify camera permissions and stream cleanup on both native WebViews. App Store / Play deployment and server photo verification are outside this change.

### Verification on 2026-09-29

- `npm ci`, lint, format check, 29 unit tests and production build passed after the EXP/gauge refinements.
- All 49 browser cases passed in one final full run. Coverage includes EXP grants, persistence, level-up carryover and consistent level labels, the thin EXP gauge and segmented stage gauge, the `1-10` → `2-1` boundary, increasing targets, quest priority and buffs, Pteranodon wing/diagonal attack/pause, all six characters' visible collision, camera selection and cleanup, portrait capture, location denial, dashboard periods, registration dates, top notices and wearable dialogs.
- Visually inspected all five attack sheets (40 poses), three Pteranodon wing positions and its in-scene impact. The downloaded Pteranodon source is non-empty and retains the original Figma image.
- Main tab heights/navigation positions match at 320/390/526/1440px and in mobile emulation. The five main tabs use a 1080px minimum height with no horizontal overflow.
- Earlier in this feature, `npx cap sync` completed for both platforms and Android `:app:assembleDebug` succeeded; the merged manifest contains only `READ_STEPS` among health permissions. Native builds were not rerun for the later web UI/game refinements.
- iOS signing/build and physical-device health/camera testing remain pending because the development host is Windows.
