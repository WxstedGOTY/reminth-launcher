# Prompt 3 for the code-writing window: six small fixes and features

Send to the Claude Code window that writes code (Opus 5.5, effort high), when the desktop window is idle.
Prompt 4 (the mod detail page) is a SEPARATE file and is sent afterwards, not together with this one.

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules) and DECISIONS_AND_TEST_PLAN.md. Pull main
first. You cannot run Electron or Minecraft: say plainly what you could not test. npm test after each job (456
pass today), commit after each finished job, push to main at the end, then rewrite DECISIONS_AND_TEST_PLAN.md as
CLAUDE.md says. Do NOT build, do NOT bump the version, do NOT touch the performance-pack code, buildJvmFlags,
safe-mode or memory code, or the privacy/terms text. The one allowed change inside minecraft.js launch() is the
narrow world-join addition described in JOB 4.

=== JOB 1: "Needs a look" becomes "Safe to delete", plus "Delete all" ===
The group is features.js CONTENT_GROUPS id "problem" (label "Needs a look"), filled by groupOf() for every item
with valid === false: in mods that is folders and non-.jar files; in resource packs/shaders/data packs it is
files that are not a .zip or a folder. Real mods/packs are never in it.
 a. Rename the label to "Safe to delete" on every content tab that has the group.
 b. Add a red "Delete all" button with a bin icon (reuse the existing danger styling and the bin icon already used
    on rows) in that group's header. Shown only when the group has items; disabled while it runs; no double click.
 c. Click opens a confirmation listing EVERY item with its size, and for a folder the number of files inside
    (count with a cap, e.g. 1000, show "1000+"). Plain words: "Minecraft ignores these. They go to the Windows
    Recycle Bin, so you can get them back." If any folder is not empty add a second line: "One or more folders
    contain files - check that none is a backup you want to keep."
 d. Items go to the Recycle Bin (shell.trashItem, exactly like content:remove already does), NEVER permanently
    deleted. New IPC content:removeInvalid(instanceId, kind): the MAIN process re-reads the folder with
    content.listAll and removes only items that are invalid there itself - it must not take a list of file names
    from the renderer, so a stale or tampered renderer can never remove a valid mod/pack. Cap the count, report
    partial failures ("Moved 2 of 3; 1 is in use"), friendlyError for the rest, refresh the list, toast the result.
 e. Not allowed while that instance is running (JOB 2 covers the guard) - for packs/shaders/data packs it is allowed.
 f. Visual fix in the same place: the italic item names are clipped on the right ("New folde", "archive.ra").
    Give the title element enough right padding / overflow-visible so the last letter is never cut. styles.css is
    CRLF and its last rule stays last.
 Tests: a pure helper for "which items are in the group" and for the main-process re-derivation (valid mods are
 never selected), with fake listAll data.

=== JOB 2: no adding, deleting or switching MODS in a running instance ===
Today the main process refuses edit/delete instance, "Update mods to fit" and the update paths while a game runs
(main.js: running.has(id)), but NOT content:setEnabled, content:remove and content:install, and the screen does
not stop them either.
 a. Main process (the real guard, the screen can be stale): content:setEnabled, content:remove, the new
    content:removeInvalid and content:install throw the same plain message ("Close the game first - that instance
    is running.") when the target is a MOD (kind "mod") and running.has(id). Work out the kind on the main side
    (from the item / request), not only from a renderer field. Resource packs, shaders and data packs stay
    allowed while the game runs (Minecraft reloads them in game).
 b. Screen, for a running instance, mods only: the on/off switches, the bin buttons, "Delete all", Install
    buttons (Mods tab, Discover), "Browse content" and the bulk bar are disabled with ONE plain line shown near
    them: "Close Minecraft to change mods." Discover's instance picker shows a running instance as unavailable
    for mods. Everything re-enables by itself when the game exits (use the existing play:exited / stopFinished
    flow) - no restart needed. "Open folder" cannot be blocked (Windows' own Explorer): show the same line next
    to it as a hint.
 c. Capture the instance id at click time as everywhere else; no stale results.
 Tests: pure helper for "is this action blocked" (kind x running), and the main handlers with a stub running set.

=== JOB 3: the Skins page lags for a moment when it opens ===
Measured on Windows in the real app: the page switch itself costs only about 12-22 ms and there are no long
JavaScript tasks, so the lag is probably not plain script work. Suspects to check in the code, in this order:
ensureViewer() creating the WebGL viewer (skinview.js) only when the page is first opened; the render loop
starting at full resolution/antialiasing; loadSkinProfile/loadSkinLibrary/loadDefaultSkins all starting in the same
frame as the switch; large skin images decoded on the main thread; CSS transitions on a big layer.
 a. Add performance.mark/measure points (clearly named "skins:...") around viewer creation, texture load and the
    three loaders, so the desktop window can read the numbers in DevTools. Keep them cheap and harmless.
 b. Prepare the viewer quietly after start-up when the app is idle (requestIdleCallback, a few seconds after the
    window has loaded and only if signed in) so opening the page only shows it.
 c. Start the three loaders after the first frame of the page has been drawn (double requestAnimationFrame), not
    in the same turn as the page switch. Decode images with createImageBitmap or decode() before they are shown.
 d. Run the 3D render loop only while the Skins page is visible; pause it when you leave. Do not lower the
    visual quality of the viewer.
 Do not claim a speed-up you did not measure; say what you changed and that the desktop window will measure.

=== JOB 4: a Play button on the Home "Jump back in" cards ===
Home cards (renderer.js recentCard) are not clickable today. Each entry has instanceId, instanceName and, for a
world, its folder name; for a server, its address.
 a. Add a small "Play" button to every card. It launches THE INSTANCE THE CARD BELONGS TO (entry.instanceId =
    the one it was last played in; fall back to the active instance only if it is missing) - not the instance
    selected in the rail. runPlay must accept an explicit instanceId (JOB 6 needs the same).
 b. Server card: use the existing join path (join {host, port}); parse "host", "host:port" and bracketed IPv6.
 c. World card: join the world directly on Minecraft versions that support it. The version JSON's own
    arguments contain the quick-play singleplayer feature ("is_quick_play_singleplayer" /
    "${quickPlaySingleplayer}") from 1.20 on; add it next to the existing quickPlayMultiplayer handling in
    minecraft.js launch(), driven by the profile, never hard-coded per version. When the profile has no such
    feature the button just starts the instance, the tooltip says "Starts this instance - this Minecraft
    version can't open a world directly", and the toast says the same.
 d. Validate the world folder name on the MAIN side before it goes anywhere near an argument: a plain folder
    name only (no path separators, no "..", no leading "."), it must exist as a directory in THAT instance's
    saves folder, length cap, no control characters. A bad value is ignored (the instance just starts).
 e. All the usual guards stay: the "mods won't load" Play gate, the install/running checks (the button is
    disabled while that instance is running or installing), a busy state, no double click, try/catch + toast.
 Tests: address parsing, world-name validation, the "supports direct world join" decision from fake profiles.

=== JOB 5 is Prompt 4 (the mod detail page) - do not start it here. ===

=== JOB 6: the Home hero shows the instance you LAST PLAYED, not the last one you clicked ===
renderHero() uses activeInstance(), which is whatever was last selected in the left rail (and saved as
settings.activeInstance). So clicking another instance just to look at its mods changes the Home screen.
 a. The hero (name, loader/version tags, text, Time played, Last played, and the Play / Instance buttons) is
    about the instance with the newest lastPlayed. If none was ever played, fall back to the selected one.
 b. The hero's Play and Instance buttons act on THAT instance (explicit id, see JOB 4a), not on the rail
    selection. Clicking an instance in the rail still opens its page and still drives the instance page and
    the sidebar; it no longer changes the hero.
 c. The hero updates by itself when a game starts or ends (check that lastPlayed is stored at launch, not only
    at exit, so the new last-played instance shows immediately).
 d. Pure helper for "which instance is the hero's" with tests (ties, never played, deleted instance, errors).

When done: push, update DECISIONS_AND_TEST_PLAN.md (what changed, files, test count, decisions, a numbered
PASS/FAIL plan for the desktop window), and tell me (a) what you could not test, (b) every file you touched,
(c) anything you decided differently and why.
```
