# Prompt 9 for the code-writing window: "may not work" mods crash the game - the fix button must handle them too

Model: Opus 5.5, effort high (job C touches the crash handling). Send when the desktop window is idle.

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules) and DECISIONS_AND_TEST_PLAN.md. Pull main
first. You cannot run Electron or Minecraft: say plainly what you could not test. npm test after each job,
commit after each finished job, push to main at the end, then update DECISIONS_AND_TEST_PLAN.md as CLAUDE.md
says. Do NOT build, do NOT bump the version, do NOT touch the performance-pack code, buildJvmFlags, safe-mode or
memory code, or the privacy/terms text (list any new sentence it needs in the hand-off file).

=== WHAT HAPPENED (real crash on the owner's PC, 3 Oct 2026) ===
Instance "Reminth" = Fabric, Minecraft 26.2, with mods built for 26.3. The owner pressed Play on a Home
"Jump back in" server card. The game started and CONNECTED to the server (crash report: "Non-integrated
multiplayer server", "Server brand: Paper (Velocity)") and then crashed on the first HUD draw:
  java.lang.NoSuchFieldError: Class net.minecraft.client.renderer.RenderPipelines does not have member
  field '...RenderPipeline GUI_TEXTURED'   at knot//squeek.appleskin.client.HUDOverlayHandler.drawExhaustionOverlay
The mod is AppleSkin, file appleskin-fabric-mc26.3-3.0.10.jar. Reminth's compatibility check already knows about
it: it is listed as "May not work - This build is listed for Minecraft 26.3, not 26.2" with a fix "Switch to
3.0.10+mc26.2". But:
  (1) the "Update mods to fit 26.2 (18)" button only counts and fixes the mods that WON'T LOAD; it leaves the
      "May not work" ones (AppleSkin, Anchor Optimizer, JEI...) alone - after pressing it the panel still shows
      them (seen in the desktop window's test);
  (2) the Play gate ("Minecraft won't start like this") only stops for "won't load" mods, so the game started
      and crashed later;
  (3) after the crash Reminth says nothing useful about which mod caused it.

=== JOB A: the fit button also fixes "may not work" mods that have an exact stable build ===
A mod whose jar is listed for another Minecraft version than the instance's (the "May not work - listed for
Minecraft X, not Y" class in compat.js) is swapped by the "Update mods to fit" button too, using exactly the
same stable-only (release) swap, backup copy (.reminth/replaced-mods) and "No build yet" list as for the blocked
ones - but ONLY when a stable build for the instance's exact version and loader exists. No build -> it stays a
warning, listed under "No <version> build yet" with the usual choices (switch off / advisor / leave); never
deleted. The button count and label include them ("Update mods to fit 26.2 (21)"); the panel's "Fix all" uses
the same set. Keep "Reminth's own jars are never touched". Tests with fake data shaped like AppleSkin (outer
jar listed for 26.3, fabric.mod.json range that 26.2 satisfies) and the existing ones unchanged.

=== JOB B: the Play gate also warns about them ===
If the instance has such "may not work (wrong version listed)" mods, Play (every entry: instance page, Home hero,
Home cards) shows the existing gate dialog with plain words: "N mods are built for another Minecraft version and
may crash the game: <names>". Buttons as today: Fix and play / Play anyway / Cancel. Play anyway remembers
nothing; the gate shows again next time (it is cheap) unless the player ticks "Don't ask again for this
instance" (stored per instance in the registry, atomic write, cleared when the mod set changes). Blocked mods
keep their stronger wording and still win when both kinds exist.

=== JOB C: after a crash, say which mod did it ===
After a game exits with a crash report newer than the launch (the launcher already finds crash-reports/ and
logs for the exit handling - reuse that, only this instance's own folder, newest report only, max 512 KB read,
never act on a path from the report), parse the "Description:" and the first stack frames for a mod package
(frames look like "at knot//squeek.appleskin.client...."; a mod id/package can be matched against the
instance's mods using the data content.listAll already has: modId, and the package prefix from the jar's
fabric.mod.json entrypoints/mixins where cheap; if unsure, say nothing). Show one plain toast + a dismissible
notice on the instance page: "The game crashed in <Mod name> (<file>). It is built for Minecraft 26.3 and this
instance is on 26.2." with a "Fix it" button (the same swap as JOB A for that one mod, or "Switch it off" when
there is no build). Never guess: no match -> no notice. Save the finding like launch-report.json does (atomic,
per instance, cleared when the file changes) so the compatibility panel shows that mod as "Crashed the game"
with the same fix. Pure parser with tests built from the real report above (NoSuchFieldError, frames in
squeek.appleskin) plus 3 other shapes (a Mixin error naming a mod, a crash with no mod frames, a truncated file).

When done: push, update DECISIONS_AND_TEST_PLAN.md (what changed, files, test count, a numbered PASS/FAIL plan for
the desktop window: the "Reminth" instance copy with AppleSkin 26.3 on 26.2 -> button count includes AppleSkin ->
after the click AppleSkin is the 26.2 build -> Play + join a server -> no crash), and tell me (a) what you could
not test, (b) every file you touched.
```
