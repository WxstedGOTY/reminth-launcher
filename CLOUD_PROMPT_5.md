# Prompt 5 for the code-writing window: two bugs the desktop window found testing Prompt 3

Send AFTER Prompt 4 is finished and pushed. Small. Opus 5.5 or Sonnet 5.5, effort medium is enough.

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules) and DECISIONS_AND_TEST_PLAN.md. Pull main
first. You cannot run Electron: say plainly what you could not test. npm test after each job, commit after
each finished job, push to main at the end, then update DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says. Do NOT
build, do NOT bump the version, do NOT touch the performance-pack code or buildJvmFlags/safe-mode/memory code.

=== BUG 1: Home's hero does not switch to the instance you just started ===
Found on Windows in the real app: start instance B while the hero shows instance A. 40 seconds later (game
running) the hero STILL shows A, though instances.json already has B's new lastPlayed; a manual
loadInstances() makes the hero switch to B at once.
Cause (read it): src/main/main.js, in startGame, right after the spawn:
    instances.update(inst.id, { lastPlayed: claim.startedAt }).catch(() => {});
    send("play:started", { instanceId: inst.id });
The update is NOT awaited, so "play:started" reaches the renderer first; renderer.js onPlayStarted calls
loadInstances() which reads the list before the write has landed (instances.update goes through the registry's
queue/lock), so it still sees the old lastPlayed.
Fix both sides:
 a. main.js: await the update (inside try/catch - a failed save must never break the launch) and only then send
    "play:started". Keep the existing semantics: lastPlayed = claim.startedAt.
 b. renderer.js onPlayStarted: also set the instance's lastPlayed in state.instances right away (the startedAt
    from the event payload if you add it, else Date.now()) and re-render the hero, so it switches even before
    the reload; then still call loadInstances() to sync.
 c. Test the ordering with a stub (the event is sent only after the save resolves; a rejecting save still
    sends the event) and the renderer helper that applies lastPlayed (pure.js has heroInstance - extend its
    tests).

=== BUG 2: after a fullscreen game the Reminth window is no longer maximized ===
Found on Windows: Reminth opens maximized (main.js: win.maximize() on ready-to-show). Start a game (the owner
runs "Start in fullscreen"), and after it ends Reminth's window is back at its small windowed size (800x552 in
the test) instead of maximized. Most likely Windows un-maximizes the window when the game takes over the
display; it is not known whether that happens at game start or at game end.
Fix: in main.js remember whether the window was maximized when a game is launched; when that game's session
ends (the existing exit/finish path - and when the window regains focus, if easier), and the window was
maximized before and is not maximized now, maximize it again. Rules: never change the window if it was not
maximized before; never steal focus from the game while it is still running (do nothing while any game is
running); respect the "launch minimized" setting (if Reminth minimized itself for the game, restore it to
what it was - maximized or normal - when the game ends, not before); send the usual "window:maximized"
state so the custom title-bar icon is right. Put the decision in a small pure function (inputs: wasMaximized,
isMaximized, isMinimized, anyGameRunning -> action) with tests.

When done: push, update DECISIONS_AND_TEST_PLAN.md, and tell me (a) what you could not test, (b) every file
you touched.
```
