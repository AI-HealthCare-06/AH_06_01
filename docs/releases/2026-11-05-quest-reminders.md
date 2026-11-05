# Quest encouragement release 2026-11-05

- Reset the encouragement countdown to 3 hours 30 minutes after a completed quest. Include main quests, permitted repeat verification, first-week profile quests, the first exercise survey, and exercise completion.
- Persist each account's anchor across app restarts. Step telemetry, combat rewards and ordinary record edits do not postpone reminders.
- Schedule only during the existing 09:00–21:00 window. When today's four main quests are complete, stop today's encouragement; later days remain scheduled. Medication time alarms retain their independent schedule.
- Flush completion and pending background updates promptly, and invalidate stale asynchronous schedules on logout, account switches or settings changes.
- Publish the Android bundle through the existing main Actions deployment. Native 1.7.0 (13) and the supported 1.5.0/1.5.1/1.5.2 OTA channels retain their verified compatibility. The workflow run number assigns the higher 1.7.x web version.

Feature PR #42 passed frontend lint, format, 384 unit tests, TypeScript and production build, all four browser shards, and Android compilation. The release and production workflows repeat the required verification. Notification permission and OS scheduling restrictions still apply.
