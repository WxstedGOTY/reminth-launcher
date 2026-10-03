# Prompt 2 for the code-writing window: make "Update mods to fit" catch everything

Paste the grey block into the Claude Code window that writes code. Suggested: Opus 5.5, effort high.
Send it only when the desktop window is idle. Pull main first (the prompt says so).

---

```
Read CLAUDE_CODE_HANDOFF_10.md sections 0 and 1 (the rules) and this file. Pull main first. You cannot run
Electron or Minecraft: say plainly what you could not test. npm test after each batch (442+ pass today),
commit after each finished job, push to main at the end. Do NOT build, do NOT bump the version, do NOT touch
the performance-pack code (minecraft.js pack functions, config.js) or the privacy/terms text.

The desktop window tested your "Update mods to fit" button on a copy of the owner's real instance (Fabric 26.2
with 29 mods built for 26.3). It worked for 16 mods (swapped to release builds, old jars copied to
.reminth/replaced-mods, Sodium and Fabric API pulled in as dependencies) - but the game STILL refused to start
because of three mods that Reminth's compatibility check never flagged, so the button never saw them. The
game's own report (logs/latest.log, "Incompatible mods found!") said:
  - Mod 'Anchor Optimizer' (client_side_anchors) 1.0.6+26.3 requires version 26.3 of 'Minecraft', but only the wrong version is present: 26.2!
  - Mod 'Client Side Crystals' (clientsidecrystals) 26.3 requires version 26.3 of 'Minecraft', ...26.2!
  - Mod 'MezzConfig' (mezz_config) 0.6.6 requires version 26.3 of 'Minecraft', ...26.2!
Why they were missed: (1) ClientSideCrystals-26.3.jar and AnchorOptimizer-26.3.jar declare ">=1.21 <=26.3" /
">=26.1 <=26.3" on the OUTSIDE (which 26.2 satisfies) but are multi-version bundles: they carry one nested jar
per Minecraft version under META-INF/jars/ and Fabric loads the 26.3 one; (2) mezz_config is a nested jar
inside jei-26.3-fabric-*.jar whose fabric.mod.json requires exactly 26.3, while JEI itself only got a soft
"may not work" notice. Look at content.readJarMeta (nestedMods / nestedUnread) and compat.js
(findDependencyProblems, judgeMod) to see what is read today.

=== JOB C: catch what the check missed ===
 1. In compat.js, evaluate the Minecraft requirement of NESTED jars too. A nested mod whose requirement the
    instance's version fails makes its outer mod "won't load" (it blocks start) - but ONLY when Fabric would
    really load that nested jar. Be careful with multi-version bundles: when a bundle nests several jars of the
    SAME mod id for different Minecraft versions, Fabric picks the highest version of that id, not the one that
    fits - so the 26.3 nested jar is what runs on 26.2 and the bundle must count as "won't load" unless the
    highest nested version fits. Write the rule down in a comment with this real example, and keep the standing
    rule: a false "blocked" is the worst outcome, so anything you can't decide with certainty stays a
    warning, not blocked. Add tests built from small fake jars that mimic exactly these two shapes
    (bundle with per-version nested jars; nested config library requiring 26.3).
 2. A safety net that does not depend on guessing: after a failed start, read the game's own report. Fabric
    prints "Some of your mods are incompatible with the game or each other!" followed by lines
    "- Mod '<name>' (<id>) <version> requires ..." and "- Replace mod ... with ...". Add a pure parser in
    compat.js (tests with the three real lines above plus the "Replace mod 'MezzConfig' ... compatible with:
    minecraft 26.2" form) that returns { id, name, version, why } per mod. After a launch that exits within the
    startup window with that report in logs/latest.log, remember those mod ids per instance in
    .reminth/launch-report.json (atomic write via atomic.js) and treat them as "won't load" in the
    compatibility check until the file they belong to changes (size/mtime) - so the panel and the "Update mods
    to fit" button see them on the next look. Map ids to files with the data content.listAll already has,
    including the outer file of a nested mod. Never act on a log line from outside the instance's own logs
    folder; cap how much of the log is read. Do not touch minecraft.js launch(), buildJvmFlags, safe-mode or
    memory code - hook in through the existing exit/crash notification in main.js instead.
 3. The button's flow for such a mod is the same as for any other: swap to the newest STABLE build for this
    exact version and loader, otherwise list it under "No <version> build yet" with switch-off / advisor /
    leave - never deleted without a click.
 4. Mods nested inside another mod (mezz_config inside JEI) cannot be swapped on their own: the fix is for
    the OUTER mod (JEI). Say so in the plain-words reason ("JEI contains MezzConfig, which needs Minecraft
    26.3") and make the fix target the outer file.

=== JOB D: release-only everywhere Reminth swaps mods without the player picking the file ===
The Mods panel's per-mod "Switch to X" and "Fix all" use Modrinth's update lookup, which ignores the release
channel, so they can install a beta/alpha silently. Make them use the same stable-only choice as the new
button (modsSync.pickStableBuild). The Mods tab's normal "Check for updates"/"Update all" is the player
choosing to update: keep it as it is, but show the build's channel (Beta/Alpha tag) next to the version in
the update list so nothing is silent. Tests.

=== JOB E: every replaced jar is recoverable ===
Today only "Update mods to fit" copies the old jar to .reminth/replaced-mods/<time>/ (newest 5 kept). Do the
same for every path that replaces or removes a mod file Reminth did not install itself: panel "Switch to",
"Fix all", per-mod update, "Update all" (content.applyUpdates), and the Mods tab delete button's
confirmation text should say it is deleted for good (do not change delete itself). Reuse the existing copy
code; the copy must never block or fail the update (best effort, log in updater-style plain words), and
nothing under replaced-mods may ever be read as a mod by listAll/compat (check that it isn't). Add an
"Undo" entry point only if it is tiny: a button in the Mods tab "Restore replaced mods" that opens the
folder is enough (shell.openPath on that one fixed folder).

When done: push, then tell me (a) what you could not test, (b) every file you touched, (c) anything you
decided differently and why.
```

---

## For the desktop window afterwards (not for the code window)

Re-run the same test on a fresh throwaway instance (Fabric 26.2 + the 29 mods of the "Reminth" instance):
click the button, then Play to the title screen. Expected now: the game starts. Then bump 1.4.0, build,
smoke-test, and you create the GitHub release.
