# Pixel adventure and device quests

This feature continues the current REXRUN demo on `feature/pixel-adventure-device-quests`, created from the latest `develop` with the existing character-customization feature merged as a prerequisite. No release is created.

## UI and game behavior

- The calendar uses the device's local date, Sunday through Saturday. Daily quest reset and step queries use the same local midnight boundary.
- New days start with no completed quests. A day qualifies for the weekly reward when all five quests are completed; five distinct qualifying days within Sunday–Saturday fill the bar. Old sample-day completions are not counted retroactively.
- Combat now follows the three supplied game documents: see [GAME_BALANCE.md](GAME_BALANCE.md) for the tables, assumptions and integration boundaries. Monsters spawn every five seconds, move toward a fixed player position, and take repeated hits based on HP, AD, DEF, range, critical chance and knockback. Hit art does not stun. The simulation continues across routes and reconciles up to 24 offline hours at the full rate.
- A stage has ten waves with 30, 40, 50, 60, 70 + Elite, 70, 80, 90, 100, 100 + Boss opponents. Backgrounds change only after all ten waves; the next stage unlocks at its recommended level, otherwise wave ten repeats. Monster feet are above the grass/soil boundary, and the stage heading explicitly separates STAGE from WAVE.
- Five characters use the supplied eight-frame attack sheets, including the new Pteranodon sheet. Only Stegosaurus retains idle artwork during attacks. Their original artwork and individual motion styles are retained without continuous player travel. Pteranodon flaps its near wing independently of the body and attacks diagonally down-right before returning to flight height. Reduced-motion mode suppresses wing motion, lunges and attack-frame cycling.
- Buff buttons use ATK / DEF / CRT / SPD / GOLD. Their inline panels show the current calculated effect and linked quest. Combat buffs and penalties use the supplied tables; missing measurements are neutral. The HP heart remains removed.
- The stage bar retains the dashboard segmented gauge with muted track and green fill. It counts all kills in the current wave, including its Elite/Boss, and shows the wave composition underneath.
- The EXP bar remains 40% of HP height with gray track/green fill and current/required EXP. Growth now starts at Lv.1 with a 100 EXP threshold and successive floored ×1.22 thresholds. Quest EXP scales by level bracket, carries surplus and grants level-up GOLD exactly once.
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
| 10 — Character Attack Motions / Walking | 446:578 | Four Pteranodon wing poses |
| 12 — Villain Hit Reactions | 464:581, 586, 591, 596, 601, 606 | Six 200ms hit poses |
| 11 — Villain Character Concepts | 300:700, 705, 710, 715; 313:694, 699 | Four ordinary opponents plus Elite/Boss artwork |

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

- `npm ci`, lint, format check, 36 unit tests and production build passed after the document-based game changes. The build reports one entry-chunk size advisory (about 503 kB, 156 kB gzip).
- All 52 browser cases passed in the final full run. Unit coverage includes one-time Coin→GOLD migration; browser coverage includes multi-hit combat, wave/Boss transitions and reload, inline buff panels and keyboard focus, RP modal minimum/maximum limits, cosmetic purchases, ordered swipe navigation, 200ms hit reactions and collapsible HUD, EXP/level labels, all six character collisions, device quests, camera/weather/dashboard controls and shared tab geometry.
- Visually inspected all five attack sheets (40 poses), three Pteranodon wing positions and its in-scene impact. The downloaded Pteranodon source is non-empty and retains the original Figma image.
- Main tab heights/navigation positions match at 320/390/526/1440px and in mobile emulation. The wallet opens its conversion/cosmetic details on demand; closed tabs retain the 1080px minimum height. Buff panels and enlarged stage labels were visually checked at 320/390px without horizontal overflow.
- Earlier in this feature, `npx cap sync` completed for both platforms and Android `:app:assembleDebug` succeeded; the merged manifest contains only `READ_STEPS` among health permissions. Native builds were not rerun for the later web UI/game refinements.
- iOS signing/build and physical-device health/camera testing remain pending because the development host is Windows.

### Main tab and wallet updates

Shop → Character → Home → Camera → Dashboard supports horizontal touch swipes, while forms, dialogs, vertical gestures and screen edges remain independent. Quests remain reachable from Home and the header search shortcut. The standalone wallet block is replaced by a GOLD-card conversion modal with minimum/maximum RP controls and no EXP/level fields. Gold cosmetics live on Character. Catalog rows fill the available height above the navigation.

Chromium mobile emulation also verified native touch dispatch in both directions between Shop and Character. Physical iOS/Android swipe behavior has not been tested.
