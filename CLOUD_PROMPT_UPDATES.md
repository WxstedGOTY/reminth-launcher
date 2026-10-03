# Prompt for the code-writing window: "mods out of sync" button + launcher update button

Paste the block below into the Claude Code window that writes code (cloud/Firefox).
Suggested model: Opus 5.5, effort high. Send it only when the desktop window is idle.

---

```
Read CLAUDE_CODE_HANDOFF_10.md (sections 0 and 1 are the rules: blunt answers, plain-JS CommonJS, no
innerHTML in the renderer, CRLF files stay CRLF, styles.css's last rule stays last, minimal surgical diffs,
never delete a player's own mod, never install alpha/beta silently, never weaken a test) and this file.
Pull main first. You cannot run Electron or Minecraft: say plainly what you could not test. Run npm test
after each batch (421 tests pass today). Commit after each finished job, push to main at the end.
Do NOT build the installer, do NOT bump the version, do NOT touch the performance-pack code in
minecraft.js/config.js or the privacy/terms text. Give me a plain list of every change at the end.

=== JOB A: a button that appears when the mods don't match the instance's version ===

What exists today (read it first): the compatibility panel on the Mods tab (src/renderer/features.js ~3600-4450,
src/main/compat.js) already lists mods that "won't load" with a per-mod "Switch to <build>" fix, a "Fix all"
button, and "Find a version that fits everything"; the Play gate ("Minecraft won't start like this: Fix and
play / Play anyway / Cancel"); and the Mods tab has "Check for updates" (content:checkUpdates /
content:applyUpdates). A player who changed an instance's Minecraft version, or imported a world/mods built
for another version, still ends up hunting for these.

What I want: whenever an instance has enabled mods that won't load on its Minecraft version/loader, a clearly
visible button appears next to Play on the instance page header (and on the Home hero when that instance is
the active one) - for example "Update mods to fit 26.3 (16)" with a warning style. One click does this:
 1. For every mod that won't load, swap it to the newest STABLE (release) build that exists for this
    instance's exact Minecraft version and loader (reuse compat's fix.update + content.applyUpdates; check
    that the version picker used there is release-only for anything done without the player choosing the
    exact file - if it can fall back to beta/alpha, the button must not use that fallback).
 2. Mods with no stable build for this version: do NOT delete them. Show a plain list ("These 3 mods have no
    build for 26.3 yet") with two choices: switch them off (rename to .disabled, reversible) or "Find a
    version that fits everything" (the existing advisor). Nothing happens to them without a click.
 3. When it is done, re-run the compatibility check, show a result toast ("Updated 13 mods, 3 switched off"),
    and the button disappears when nothing is blocked. The button must not show for vanilla instances, while
    the game is running, or while another install/update on that instance is in progress; no double-click
    (disable while running, re-enable in finally); capture the instance id at click time and ignore a stale
    result if the player switched instances.
 4. Also offer it right after the player saves an instance edit that changed the Minecraft version or loader
    (a one-time inline notice with the same button, dismissible) - this is the moment mods fall out of sync.
 5. Reminth's own managed jars (performance pack, HUD, Fabric API) are not touched by this button; they are
    already swapped at launch.
Keep every safety property: the player's own files are never deleted, only replaced by the update flow that
already keeps the old file safe (check how applyUpdates replaces files and keep that behaviour), no network
call from the renderer (IPC only), friendlyError() on failures. Add tests for any new pure logic (which mods
count, release-only choice, the "no build" list) in a new test/mods-sync.test.js; the existing compat and
content tests must stay green unchanged.

=== JOB B: updating the launcher itself, with a button ===

What exists today: src/main/updater.js uses electron-updater against this repo's GitHub releases. It checks
ONCE, 10 seconds after start, downloads in the background, and the renderer shows a bar "Reminth X is ready.
It installs when you restart." with a Restart button (renderer.js ~538, index.html #updateBar). It is silent
about everything else (errors only go to updater.log), so a player who is not sure whether the launcher is up
to date has no way to find out, and a launcher left open for days never checks again.

What I want:
 1. Settings > the "Reminth <version>" card gets a "Check for updates" button with plain states:
    "Checking...", "You're on the latest version (1.3.0)", "Downloading Reminth 1.4.0... 42%",
    "Reminth 1.4.0 is ready" + a "Restart and update" button, and on failure a plain message ("Couldn't check
    for updates - are you online?") plus a "Download it manually" link that opens the GitHub releases page
    in the default browser (use the existing safe external-open path; only that one fixed URL).
 2. The automatic behaviour stays: check 10 s after start, download in the background, install on quit. Add a
    re-check every 6 hours while the launcher stays open. Automatic checks stay quiet when there is nothing
    new or when offline; only the manual button shows "up to date" / errors.
 3. The existing top bar keeps working (now also showing download progress when the manual check is what
    started it). Never interrupt a running game: "Restart and update" is disabled with the note "Close
    Minecraft first" while a game is running (the main process knows - see the `running` set in main.js);
    the install-on-quit path must not kill a running game either.
 4. Main process: expose update:check (returns the state), forward electron-updater's download-progress and
    error events to the renderer as update:status states, keep logging to updater.log, never throw into the
    renderer. Preload: checkForUpdates, plus the existing onUpdateStatus/installUpdate. A dev run
    (not packaged) answers "Updates only work in the installed app".
 5. The installer is unsigned (no certificate, no money): do not add anything that pretends otherwise.
 6. Tests: test/updater.test.js with electron and electron-updater stubbed (the other test files show how):
    state transitions, the 6-hour timer (inject the timer), "not packaged", offline error mapping, and that
    nothing runs while a game is running.
 7. Do not change package.json's version and do not change the publish settings.

When both jobs are done: push, and tell me (a) what you could not test, (b) every file you touched.
```

---

## What the desktop window does afterwards (not for the code window)

1. Pull, `npm test` on Windows, click through both features in the real app (blocked-mods instance: your
   "Reminth" instance is on 26.2 with 26.3 mods, which is the perfect test case; the update button needs a
   second, newer build to see the real download, so it is tested with a local update feed).
2. Bump to 1.4.0, build, smoke-test the packaged app.
3. You create the GitHub release (steps in the chat), then every installed copy updates itself.
