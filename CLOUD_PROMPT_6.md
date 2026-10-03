# Prompt 6 for the code-writing window: the window bug is not fixed yet (found with the real Win32 state)

Small. Sonnet 5.5 or Opus 5.5, effort medium. Send when the desktop window is idle.

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules) and DECISIONS_AND_TEST_PLAN.md. Pull main
first. You cannot run Electron: say plainly what you could not test. npm test after the job, commit, push to
main, then update DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says. Do NOT build or bump the version. Touch only
the window code in main.js and src/main/windowRestore.js (+ their tests).

=== BUG: after a fullscreen game Reminth's window stays small although it still says "maximized" ===
Prompt 5's fix (windowRestore.afterGame) does not trigger. Measured on Windows in the real app (Reminth
maximized, "Start in fullscreen" on, "launch minimized" off, display 1920x1080):
  - Start any game: Reminth's window immediately becomes 800x552 (client area) - it happens at game START.
  - Close the game normally: the window stays 800x552.
  - Win32 says IsZoomed = TRUE for that window (rect (-8,-8)-(808,560)), Electron's win.isMaximized() is
    therefore true, and the custom title-bar icon still shows the "restore" glyph. So the window is
    flagged maximized but is NOT filling the work area. afterGame() only acts on windows that are not
    maximized, so it does nothing.
  - Repair that works (tested by clicking the title-bar maximize button twice): win.unmaximize() then
    win.maximize() -> 1320x840 -> 1920x1032 and everything is normal again.
Fix: in the "game ended" / window focus / restore handling, add the case "the window says it is maximized
but its bounds do not match the display work area": compare win.getBounds() with
screen.getDisplayMatching(bounds).workArea (maximized frameless windows on Windows extend about 8 px beyond
the work area on each side - allow a tolerance, e.g. width and height within 24 px of the work area plus 16)
and, only when it is clearly smaller, run unmaximize() then maximize() (then send window:maximized true).
Rules: only when it was maximized when the game started (the snapshot you already take); never while any
game is running (it must wait for the game to end, as now); never touch a window that is genuinely not
maximized; never steal focus beyond what the existing code already does; do this at most once per game end
so it can't loop. Put the decision into the pure function (inputs now include a boolean boundsFillWorkArea) and
extend test/window-restore.test.js: flagged-maximized-but-small -> repair; flagged-maximized-and-full -> nothing;
not maximized -> nothing; game still running -> wait; already repaired once -> nothing.
Also log one plain line to the launcher's existing error/diagnostic log when it repairs, so the desktop
window can see it happened.

When done: push, update DECISIONS_AND_TEST_PLAN.md (what changed + a PASS/FAIL step: play fullscreen, quit,
window is 1920x1032 again), and tell me (a) what you could not test, (b) every file you touched.
```
