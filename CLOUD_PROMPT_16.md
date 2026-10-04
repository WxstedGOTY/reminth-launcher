# Prompt 16 for the code-writing window: hunt every bug and glitch in the launcher (read-and-fix audit)

Model: Opus 5.5, effort high (many files, subtle races). Send it any time; it does not need the desktop window while it works.

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules) and DECISIONS_AND_TEST_PLAN.md (top to
bottom: what changed lately, what is untested). Pull main first. You cannot run Electron or Minecraft: say
plainly what you could not test. This is an AUDIT-AND-FIX job, not a feature job: do NOT add features, do NOT
bump the version, do NOT build. Do NOT touch hud/, hud-1.21/, assets/mods/ or the privacy/terms text.

THE GOAL: the owner wants every small and big bug and glitch found. Read src/main/*.js and src/renderer/*.js
(renderer.js, features.js, pure.js, markdown.js, skinview.js, index.html, styles.css) end to end, with fresh eyes,
looking for what a real player on a normal Windows PC would hit. Work file by file and keep a running list.

Look especially for:
 1. Data loss: any write to instances.json, settings.json, account.json, options.txt, mods/, saves/ that is not
    atomic or can race another write; any delete without a guard; any place that could touch a player's own files.
 2. Races and double actions: a click handler that can run twice, an async step that reads state it then uses
    after an await (the instance or setting changed meanwhile), a Play / Stop / delete / update that can overlap.
    (Recently found the hard way: Reminth forgot a running game after a restart and let Play start a second copy -
    runningGames.js now fixes that; look for the SAME kind of "memory only" assumption elsewhere.)
 3. Windows realities: paths with spaces, accents or Greek letters in the user name, OneDrive-redirected folders,
    very long paths, a drive that is full, antivirus holding a file open (EBUSY/EPERM/EACCES), a read-only file,
    network drives, a clock that is wrong.
 4. Offline and slow networks: every fetch needs a timeout and a plain message; nothing may hang the UI; a half
    downloaded file must never be used.
 5. Error handling: empty catch blocks that hide a real problem, promises with no catch, an error message that
    shows a raw stack or technical text to a player (friendlyError exists).
 6. UI glitches: text that overflows or is cut off at the smallest window (1100 px) and at 150% Windows scaling,
    dialogs that cannot be closed, focus lost after a dialog closes, a button that stays disabled after an error,
    stale numbers after an action (counts, badges), the page showing a previous instance's data after switching
    fast, content that is invisible or dim in some state (the 1.4.2 "animations paused" bug was exactly this -
    check every CSS animation/transition/opacity:0 start state for the same trap).
 7. Security basics: anything from the network or from a mod/modpack file used in a path, a command line, innerHTML
    or a URL without validation (the rules already ban innerHTML; check they are kept).

For each REAL bug you are sure about: fix it with the smallest change, add a test that fails before and passes
after, npm test after each fix, commit after each fix. For something you are NOT sure about, or that needs a
decision, do NOT guess: list it. Never "improve" working code for style.

When done: push, then rewrite DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says, with a new section "Audit 16" that has
(a) every bug fixed (file, line, what a player would have seen, the test), (b) every suspected problem NOT fixed
and why, ordered by how likely a player is to hit it, (c) a numbered PASS/FAIL list for the desktop window of
the fixes that need a real Windows check. Tell me (a) what you could not test, (b) every file you touched.
```
