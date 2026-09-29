# Pixel adventure and device quests

This feature continues the current REXRUN demo on `feature/pixel-adventure-device-quests`, created from the latest `develop` with the existing character-customization feature merged as a prerequisite. No release is created.

## UI and game behavior

- The calendar uses the device's local date, Sunday through Saturday. Daily quest reset and step queries use the same local midnight boundary.
- New days start with no completed quests. A day qualifies for the weekly reward when all five quests are completed; five distinct qualifying days within Sunday–Saturday fill the bar. Old sample-day completions are not counted retroactively.
- One randomly selected enemy appears per encounter. Attack → defeat → coin drop → movement → next enemy runs only while the Home screen is visible and unpaused. Each completed encounter grants 10 demo coins once. Every ten enemies advances to the next background; all six stages cycle.
- Four characters use the supplied eight-frame attack sheets. Stegosaurus and Pteranodon retain their idle art during attacks. All six have distinct travel animations. Reduced-motion mode removes decorative CSS animation.
- Cards, controls, progress bars, navigation and text use pixel styling. Korean text uses the local [Galmuri](https://github.com/quiple/galmuri) font (OFL-1.1); English headings retain Press Start 2P.
- Camera access begins only after tapping “카메라 켜기”. Medicine/water prefer the front camera; meals prefer the rear camera. Changing a quest restarts an active stream with the new lens. Sleep is excluded. Preview and capture share a 3:4 portrait crop. The stream stops on capture, hidden page or unmount. Photos remain in the page's memory. Live recognition and server photo verification are not implemented.
- Attacks approach the visible enemy at impact. Pteranodon hovers and flies above the ground. Radar lines use a 2px staircase grid.
- Notices appear at the top safe area; dialogs remain modal. The account page shares the profile avatar, shows available battery/network status without a simulated punch hole, and includes back navigation, a pixel switch and wearable setup guidance.
- Step-connection guidance sits above the quest list. Home has walk/water bars and counts next to the title, without redundant completion text.
- Dashboard radio controls switch between weekly prediction and monthly/yearly sample history. Growth details sit directly below the score. Risk cards show the actual latest profile registration date, or an unregistered state. Only that date is persisted, not the health inputs. History and predictions remain labeled demo data.
- The greeting uses [Open-Meteo current weather](https://open-meteo.com/en/docs) after location permission. Coordinates are rounded to two decimals, used for the request and not persisted. Already-granted permission allows refresh on foreground return after 30 minutes; otherwise the user requests weather with the greeting button. Denied location and network errors keep a neutral fallback with retry.

## Original Figma art

The source is [REXRUN](https://www.figma.com/design/lCWaAEae4xccaADW0osrLx/REXRUN?node-id=5-2). This change reads Figma and does not edit it. Local original image files are named by node ID under `frontend/public/assets/battle/`; the mapping lives in `frontend/src/design/battle-assets.ts`.

| Section | Nodes | Use |
| --- | --- | --- |
| 08 — GameStage Background Variants | 258:697, 701, 705, 709, 713, 717 | Six scrolling stage backdrops |
| 09 — Dino Character Assets | 276:699, 702, 705, 709, 712, 715 | Right-facing adventure and portrait artwork |
| 10 — Character Attack Motions | 288:700, 290:697, 295:697, 308:697 | Triceratops, Tyrannosaurus, Brachiosaurus and Raptor attack sheets |
| 11 — Villain Character Concepts | 300:700, 705, 710, 715; 313:694, 699 | Six random opponents |

Attack sheets contain eight hand-positioned poses, not equal-width cells. Explicit frame bounds and connected-component separation preserve whole poses and remove neighboring silhouettes where their horizontal bounds overlap. Frames share scale and baseline. Concept cards' edge-connected white backgrounds are removed only during canvas rendering; original assets are unmodified. Onboarding retains the existing left-facing artwork.

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

- `npm ci`, lint, format check, 22 unit tests and production build passed.
- All 44 browser cases passed across the full run and targeted rerun (41 initial passes, two corrected test fixtures and one new collision test; the affected 19-case set passed). Coverage includes all six characters' visible collision, front/rear camera selection and stream cleanup, portrait capture, location denial, history periods, registration dates, top notices and wearable dialogs.
- Main tab heights/navigation positions match at 320/390/526/1440px and in mobile emulation. The five main tabs use a 1080px minimum height with no horizontal overflow.
- `npx cap sync` completed for both platforms. Android `:app:assembleDebug` succeeded; the merged manifest contains only `READ_STEPS` among health permissions.
- iOS signing/build and physical-device health/camera testing remain pending because the development host is Windows.
