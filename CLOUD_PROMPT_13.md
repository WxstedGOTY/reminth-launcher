# Prompt 13 for the code-writing window: "Your mods already fit" must be true of the FILES, not just of Modrinth

Model: Sonnet 5.5, effort medium. Small and urgent: it blocks release 1.4.1. Send when the desktop window is idle.

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules) and DECISIONS_AND_TEST_PLAN.md. Pull main
first. You cannot run Electron: say plainly what you could not test. npm test, commit, push to main, then
update DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says. Do NOT build, bump the version, or touch anything outside
the version picker (openVersionAdvisor in features.js and its pure helpers).

=== THE BUG (found by the desktop window in the real app, 3 Oct 2026) ===
Prompt 12 job 2 made the "Pick a Minecraft version for my mods" dialog say, when the CURRENT version fits:
  "Your mods already fit Minecraft <current> - there is nothing you need to change."
"Fits" there comes from the advisor's data: a build EXISTS on Modrinth for that Minecraft version. It says
nothing about the mod FILES that are actually installed in the instance. Real case: a throwaway instance on
Minecraft 1.21.1 holding the mod files of a 26.2 instance. Modrinth has 1.21.1 builds for all 32 mods, so the
dialog said "Your mods already fit Minecraft 1.21.1 - there is nothing you need to change", while on the same
screen behind it the Mods panel said "28 mods will stop Minecraft from starting" and the yellow button said
"Update mods to fit 1.21.1 (31)". The sentence is false and tells a newcomer to do nothing while the game
cannot start. This is the most common real situation (a player just changed the version).

=== THE FIX ===
 1. The sentence "Your mods already fit Minecraft <current> - there is nothing you need to change." may only
    appear when BOTH are true: (a) every checked mod has a build for the current version (as today), and
    (b) the installed files really fit: the instance's compatibility result (compat:check for this instance,
    the same data the Mods panel and the yellow button use) has zero blocked ("won't load"), zero "may not
    work" and zero "crashed the game" mods. If the compatibility result isn't available yet, show a neutral
    "Checking your installed mods..." state and decide when it arrives; never default to the happy sentence.
 2. When (a) is true but (b) is not (builds exist, but N installed files are for another version), show an amber
    line instead: "Builds exist for Minecraft <current> for all your mods, but N of the files in this instance
    are made for another version. Press \"Update mods to fit\" to swap them." with that button INSIDE the
    dialog (it runs the same operation as the yellow button on the instance page, with its progress and result
    toast, then re-checks and re-renders this line). The "Other versions that also fit" list is shown as
    today (no "Best match" badge, no preselected row).
 3. When (a) is false (some mods have no build for the current version), keep today's behaviour from before
    prompt 12: the best-match line and the ranked list (this is the case the owner originally asked for).
 4. Add pure-helper tests for the decision with fake data: all four combinations of (a) x (b), compat result
    missing, and counts that include blocked + may-not-work + crashed.

When done: push, update DECISIONS_AND_TEST_PLAN.md with a numbered PASS/FAIL plan for the desktop window (a
throwaway Fabric 1.21.1 instance holding 26.2 mod files must show the amber line and its button; pressing it
turns the line green; a 26.2 instance with 26.2 files shows the green sentence), and tell me (a) what you could
not test, (b) every file you touched.
```
