# Prompt 17 for the code-writing window: a second bundled mod (the home screen) + `reminth://` links

Model: Opus 5.5, effort high (touches the install path of every instance, so it must not break the HUD). Send it now;
it does not need the desktop window while it works. Read `HOME_SCREEN_PLAN.md` first (section 6 is this job).

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules), HOME_SCREEN_PLAN.md (section 6 is YOUR job:
sections 1-5 are the desktop window's) and DECISIONS_AND_TEST_PLAN.md. Pull main first. You cannot run Electron
or Minecraft: say plainly what you could not test. npm test after each job, commit after each finished job, push to
main at the end, then rewrite DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says. Do NOT bump the version, do NOT build.
Do NOT touch hud/, hud-1.21/ or assets/mods/*.jar, and do NOT edit the privacy/terms text (list the sentences it
needs in the hand-off file instead; the owner's name there stays as it is).

=== JOB 1: a second bundled mod, "reminthhome" (the Reminth title screen) ===
Today exactly one mod is bundled in assets/mods/: ReminthHUD. Its handling is spread over src/main/minecraft.js:
  - wantsHud = instance.hud === true && fabric/quilt (about line 164), the install block (about 231: findReminthHudFor
    -> installBundledJar -> note(jar, "reminthhud", true)), tidyManagedMods(dropHud) (about 304 and 2118/2133),
    bundledReminthHudBuilds / findReminthHudFor (about 390-430; reads each jar's fabric.mod.json "depends.minecraft"
    and picks the build whose range fits via mcRangeAccepts), managedModFromName (about 1648: ^reminthhud- ->
    "reminthhud"), managedModLabel (about 1658), isPerformanceMod (about 1703), the line about 1830, plus
    paths.js REMINTHHUD_ASSET_DIR, instances.js (hud field, defaults, sanitizing, the update() whitelist),
    main.js ("hud:supports", instances:create/update), and the instance dialog in renderer.js (the "ReminthHUD"
    switch: hudField / paintHud / pick.hud).
Make this ONE generic mechanism with two entries and keep ReminthHUD's behaviour exactly as it is:
  { mod: "reminthhud",  filePrefix: "reminthhud-",  flag: "hud",        label: "ReminthHUD" }
  { mod: "reminthhome", filePrefix: "reminthhome-", flag: "homeScreen", label: "Reminth home screen" }
For the second one:
  a. New instance field `homeScreen` (boolean). **A missing value counts as ON** for Fabric/Quilt instances (so
     every existing instance gets it once a jar exists, with no migration); the player's explicit false is kept.
     Sanitize like `hud`; allow it in instances.update; accept it in instances:create.
  b. Installed on Play exactly like the HUD: the build whose declared Minecraft range fits, copied with
     installBundledJar, recorded as managed (own mod, "reminthhome"), removed again when the switch is turned off
     (tidyManagedMods) and NEVER treated as a performance-pack mod or as one of the player's mods; a player's own
     copy of a mod with the same id is respected the same way the HUD respects it. If no bundled jar fits the
     instance's Minecraft version, nothing happens and nothing is reported as an error (today there is NO such jar:
     assets/mods has none, so the whole feature must be a quiet no-op until the desktop window adds one).
  c. A "Reminth home screen" switch in the instance dialog next to the ReminthHUD one, with the same "No build for
     <version> yet" wording when none fits (a new IPC like hud:supports, generic by mod id).
  d. The Mods tab shows it as a Reminth-managed mod (label above) wherever ReminthHUD is shown.
  Tests (fake jars written into a temp assets folder; look at how the existing HUD tests do it): selection by
  version range for both mods; installed when on, removed when off, untouched when none fits; the explicit
  false is kept; a missing value counts as on; ReminthHUD's existing tests still pass unchanged.

=== JOB 2: `reminth://` links ===
The game's title screen will have a Skins button that cannot change a skin itself (only the launcher can). It will
open `reminth://skins` with the operating system, which must bring Reminth to the front on its Skins page.
  a. Register the scheme: package.json build.protocols [{ name: "Reminth", schemes: ["reminth"] }] so the
     installer writes it, and app.setAsDefaultProtocolClient("reminth") for a packaged app only.
  b. Handle it: the link is in process.argv when Reminth is started by it, and in the argv of the "second-instance"
     event when Reminth is already running (the single-instance lock already exists in main.js). Bring the window
     forward (restore/focus, never steal focus while a game runs: the existing rules about the window during a game
     apply) and tell the renderer which page to show.
  c. A pure function parseDeepLink(argvOrString) -> { page: "skins" } | { page: "home" } | { page: "instance", id }
     | null. STRICT allow-list: exact scheme "reminth:", host `skins` | `home` | `instance/<id>` where <id> matches
     the instance id pattern (letters, digits, dash, max 40) and exists. Anything else (extra path, query that does
     something, other scheme, huge input, control characters, a path like ../, a different case trick) -> null and
     it is silently ignored. A link may come from a web page or a chat message, so a link must never play a game,
     install, delete, download, sign out or send anything: it ONLY switches the page.
  d. Renderer: switch to that page through the existing switchPage / selectInstance paths (guard: the instance
     list may not be loaded yet when the app is started by the link; handle that order).
  Tests: parseDeepLink with good links, every bad kind above, argv noise ("--some-flag", the exe path, the
  `--user-data-dir=` kind of arguments), and that the handler calls nothing but the page switch.

=== WHEN DONE ===
Push, rewrite DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says: what changed with file names, the test count, decisions
(recommendation first), weak spots, and a numbered PASS/FAIL list for the desktop window. The list must include:
(1) installed 1.4.x with HUD on: nothing about the HUD changed; (2) a fake `reminthhome` jar dropped in assets/mods
for a 26.2 instance is copied into mods/ on Play and removed when the switch is turned off; (3) with the packaged
app: `start reminth://skins` from Windows opens/brings up Reminth on Skins, both when it is closed and when it is
already running; `reminth://../../x` and `reminth://play/anything` do nothing; (4) the installer registers the
scheme under the current user (no admin prompt). Tell me (a) what you could not test, (b) every file you touched.
```
