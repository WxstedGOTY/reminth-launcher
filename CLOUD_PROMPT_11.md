# Prompt 11 for the code-writing window: the "which Minecraft version" / mod-sync flow, made clear

Model: Opus 5.5, effort high (this is the part new players get lost in; it changes a real flow end to end).
Send AFTER Prompt 10 is finished and pushed. Desktop window must be idle.

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules) and DECISIONS_AND_TEST_PLAN.md. Pull main
first. You cannot run Electron: say plainly what you could not test. npm test after each job, commit after each
finished job, push to main at the end, then update DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says. Do NOT build,
do NOT bump the version, do NOT touch the performance-pack code, buildJvmFlags, safe-mode or memory code, or the
privacy/terms text. Rules that matter: no innerHTML; never delete a player's own mod; never install alpha/beta
silently (stable builds only, as modsSync.pickStableBuild); every replaced mod file is copied to
.reminth/replaced-mods first; worlds are never copied or modified by a copy; every async click captures the
instance id at click time, guards double clicks, re-enables in finally, toasts friendlyError().

Owner feedback from a real tester: "I pick a version and some mods still don't fit. Say clearly that this mod
must be turned off because there is no way it will sync with the rest. And stop creating me a million
instances. Someone new gets really confused. Make it less complex."

=== HOW IT WORKS TODAY (read these first) ===
- features.js openVersionAdvisor(instanceId, options): the dialog "Which Minecraft version should I use?"
  (opened from the Mods panel button "Find a version that fits everything", the Play gate, and server Play).
  Step 1 lists candidate versions with a one-line summary (modsLine: "All 29 mods" or "22 of 29 mods - no build
  of A, B, C"); step 2 asks to confirm; the ONLY action is "Make a copy" -> compat:copyToVersion ->
  migrate.copyToVersion, which creates a NEW instance on that version, carries options/servers/resource packs/
  shaders/config (never worlds), re-fetches each Modrinth mod for the new version and SKIPS the ones with no
  build or that aren't from Modrinth (result {installed, skipped:[{title, why}], unknown}).
- So every attempt = one more instance, and the player only learns afterwards (if at all) which mods were left
  out and why.

=== JOB 1: say what happens to EVERY mod before anything is done ===
 In the candidate list (step 1) and the confirm step (step 2), group the player's mods in plain words:
   - "Will work (N)"
   - "No build for <version> (N): <names>. They can't work with the rest on this version, so they will be
     <turned off | left out of the copy>."  (one short line per mod, with its name; collapsed if > 6)
   - "Not from Modrinth, Reminth can't check these (N): <names>. They will be <kept as they are | left out>."
   Decide what really happens to each group for each action (JOB 2) and state exactly that, no vague words.
 Mark the best choice at the top: "Best match: 1.21.1 - all 29 mods fit" or, when none is perfect, "Fits most:
 1.21.4 - 3 mods have to be turned off". Sort by fewest problem mods, then newest. Show at most the best 5 by
 default with "Show more versions". Use "build" only as "the version of the mod made for <Minecraft version>"
 (say that once, in a one-line help text at the top of the dialog).
 Tests: pure grouping/sorting helper with fake advice data (perfect match, partial, none, unknown mods).

=== JOB 2: change THIS instance, or make a new one - two clear choices, safe default ===
 Replace the single "Make a copy" with two plain options (radio cards), each with one sentence:
   A. "Switch this instance to <version>"   - "Your mods are updated to fit. Mods with no build for <v> are
      turned off (you can turn them on again). Your worlds stay. A backup of every replaced mod is kept."
   B. "Keep this one as it is and make a new instance on <version>" - "Nothing here changes. Costs disk space;
      worlds are not copied."
 Defaults and safety:
   - Recommended = A when <version> is the same or NEWER than the instance's current version; B is the
     recommended (and only enabled) choice when <version> is OLDER than the current one AND the instance has
     worlds (a world saved in a newer version can be damaged by an older one) - say that in one plain
     sentence. When a server is the reason (options.server), keep the existing "join after" behaviour for both.
   - A is not allowed while the instance runs (same plain message as everywhere), and not for modpack
     instances (their mod list belongs to the pack: show B only, with the reason).
   - A runs entirely in the MAIN process as one operation (new IPC compat:switchVersion): 1) re-check that the
     instance isn't running; 2) write down in .reminth/version-change.json the previous mcVersion/loaderVersion
     and the time (atomic) so a failed run can be completed or reverted; 3) resolve the loader version for the
     new Minecraft version (the same resolution the instance edit uses; if the loader has no build for that
     version, stop BEFORE changing anything and say so); 4) update the instance (mcVersion, loaderVersion)
     through the registry's normal queue; 5) run the existing stable-only swap (modsSync) for every mod, with the
     replaced-mods backup; 6) every mod with no stable build is switched off by renaming to .disabled (content
     setEnabled path, never deleted); 7) invalidate caches, send progress events like copyToVersion does, and
     return {updated:[names], turnedOff:[{title, why}], unknown:[names], kept:[...]}.
     If step 3 or 4 fails nothing else has happened; if step 5/6 fails halfway the instance is on the new
     version with a clear message and the version-change.json note, never in a half-written state.
   - B stays exactly as migrate.copyToVersion works today (reuse; also record madeFor from Prompt 10 if it is
     merged), but now asks the confirmation sentence once and offers "Use <existing instance>" when an instance
     on that version+loader already exists (do not make a duplicate).
 Tests: the decision helper (newer/older/same x worlds x modpack x running -> allowed options + recommended),
 the main-process operation with stubs for each failure point (no loader build, update fails, swap partial),
 and that nothing is deleted in any path.

=== JOB 3: a result screen that says exactly what happened and what to do next ===
 After A or B, one screen (not a toast): "Done - <instance> is on Minecraft <v>."
   "Updated (N)" collapsed list; "Turned off (N)" - each with its name, the reason in plain words ("no version
   made for 1.21.4") and two buttons per mod: "Find a replacement" (opens Discover with the mod's name in the
   search box and this instance selected) and "Turn on anyway" (the game may not start); "Not checked (N)".
 A single big button at the bottom: Play (or "Play <server>" when a server started the flow) and a small
 "Close". After closing, the instance page's Mods panel shows the turned-off mods in the existing "Off" group
 with their reason as a subtitle ("Turned off by Reminth: no build for 1.21.4") - store a short reason per file
 in the instance's .reminth bookkeeping (atomic), cleared when the player turns it on or removes it.
 Tests for the reason bookkeeping (set, clear on enable/remove, survives a restart).

=== JOB 4: less jargon, fewer entry points ===
 - Rename the dialog "Which Minecraft version should I use?" to "Pick a Minecraft version for my mods" and the
   Mods panel button "Find a version that fits everything" to "Pick a version that fits my mods" (all three
   places the label is defined: features.js ~4108, ~4839, ~5440).
 - One short intro line at the top of the dialog (what it does in one sentence, and "nothing changes until you
   confirm").
 - Never say "loader build", "managed", "tied", "advice" or "candidate" in text the player sees; use "mods", "version",
   "turned off", "left out". Read every string in this flow (advisor, confirm, running, result, the Play gate
   texts that open it) and rewrite them plainly. Keep all text in the renderer (no innerHTML).
 - In the Play gate ("Minecraft won't start like this"), when some mods have no build for any newer version
   either, show the one-line explanation instead of leaving the player with "Find a version" that cannot help.

When done: push, update DECISIONS_AND_TEST_PLAN.md (what changed, files, test count, decisions with
recommendations, a numbered PASS/FAIL plan for the desktop window using a throwaway copy of the owner's
"Reminth" instance (Fabric 26.2 with 29 mods): open the dialog, read the groups, pick a newer version ->
"Switch this instance" -> result screen lists updated/turned off -> the game starts; pick an older version
with worlds -> only the new-instance option; make a new instance -> confirmation + madeFor + no duplicate;
turned-off mods show their reason in the Off group; "Find a replacement" opens Discover), and tell me
(a) what you could not test, (b) every file you touched.
```
