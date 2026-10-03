# Prompt 7 for the code-writing window: one wording fix in Settings > Check for updates

Tiny. Sonnet 5.5, effort low/medium. Send any time the desktop window is idle; it is NOT needed for the 1.4.0 release.

---

```
Read CLAUDE.md and CLAUDE_CODE_HANDOFF_10.md sections 0-1. Pull main first. npm test, commit, push, update
DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says. Touch only the update-status wording (src/main/updater.js and/or
the renderer text that shows it) and its tests (test/updater.test.js).

Found in the packaged 1.4.0 app: Settings > "Check for updates" says "You're on the latest version (1.1.1)"
while the app is 1.4.0. The number shown is the newest version GitHub's feed has (the only release published is
the old 1.1.1), not the version the player is running. Fix: the "up to date" message shows the version that
is running (app.getVersion()), e.g. "You're on the latest version (1.4.0)". If the feed's newest version is
OLDER than the running one (a dev build or an unpublished build), still say "You're on the latest version
(<running>)" - never show the feed's number there. Keep every other state and message as they are. Add tests
for: feed newer (downloading), feed equal, feed older, feed missing.

When done: push and tell me the files you touched.
```
