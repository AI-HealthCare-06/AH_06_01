# Quest encouragement countdown

The Android local encouragement schedule waits 3 hours 30 minutes from the last completed quest. It repeats at that interval during the existing 09:00–21:00 window. Overnight reminders resume at 09:00; four completed main quests suppress the rest of that day's encouragement, while later days remain scheduled. Medication time alarms retain their independent schedules.

The account-owned notification settings persist the anchor. Main quest completion, permitted repeat meal/water verification, first-week profile quests, the first coach survey, and exercise completion reset it. Progress telemetry, battle ticks, survey corrections, app resume, and progress visibility changes do not postpone it. Enabling reminders starts a new countdown.

Pending encouragement is replaced as a group. Async scheduling checks its generation and current account before posting, so logout, switching accounts, disabling reminders and newer requests invalidate stale jobs. App resume rebuilds the remaining seven-day window using the saved anchor. OS power restrictions and notification permissions can still delay delivery; local scheduling does not require the WebView to stay active.

No database schema, native plugin, signing key or compatibility fingerprint changes are required. Deploy through the existing feature → develop → release → main pipeline to update both APK assets and compatible signed OTA channels.
