# Prompt 12 for the code-writing window: lifetime "Time played" on Home + three small fixes from the desktop test

Model: Sonnet 5.5, effort medium (small, but the first job touches how play time is counted). Send when the desktop window is idle.

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules) and DECISIONS_AND_TEST_PLAN.md. Pull main
first. You cannot run Electron: say plainly what you could not test. npm test after each job, commit after each
finished job, push to main at the end, then update DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says. Do NOT build,
do NOT bump the version, do NOT touch the performance-pack code, buildJvmFlags, safe-mode or memory code, or the
privacy/terms text (list any new sentence it needs in the hand-off file).

=== JOB 1: Home "Time played" = the player's whole life on the launcher (owner's correction) ===
In Prompt 3 the Home hero's "Time played" was changed to the hero INSTANCE's time. That was wrong. The owner wants
the Home screen to show the OFFICIAL total: all the time this player has ever played through Reminth, across
every instance, for the whole life of the launcher. Each instance keeps its own time on its own instance page
(unchanged). "Last played" on Home stays about the hero instance.
 a. A lifetime counter that does not depend on the instance list: store `totalPlayTimeMs` in settings.json
    (store.js sanitizeSettings: a finite non-negative integer, capped sensibly, default absent). It must survive
    deleting an instance (today the sum of instance playTimeMs shrinks when one is deleted - that is exactly why
    a separate counter is needed).
 b. Where play time is added today (the session-finish path in main.js that updates an instance's playTimeMs),
    add the same duration to totalPlayTimeMs in the same step, with the same safeguards (a session that never
    really started adds nothing; a crash counts the time it ran; two games at once both count). Use the settings
    write queue/atomic helpers that exist; a failed counter write must never break the exit handling.
 c. One-time seeding: when settings has no totalPlayTimeMs yet, set it to the SUM of all current instances'
    playTimeMs (at app start, before it is ever displayed), so nobody starts from zero. Never seed twice; never
    lower the counter; never recompute from instances afterwards.
 d. Home shows the counter (formatPlaytime as today, e.g. "12h 6m"), with a tooltip: "All your time in
    Minecraft through Reminth, across every instance - including ones you deleted." The label can stay "Time
    played". The live update when a game ends must work (Home refreshes it).
 e. The Player Statistics page and the instance page are NOT changed.
 Tests: seeding (absent -> sum; present -> unchanged; garbage -> treated as absent), increment on session end,
 survives instance deletion, sanitizing, and the Home helper that picks the number.

=== JOB 2: the version picker must not tell a player to switch away from a version that already fits ===
Seen in the real app: the instance is on Minecraft 26.2, all 32 mods fit 26.2, and the dialog's green line says
"Best match: 26.1.2 - all 32 mods fit" (26.1.2 was only the best OTHER version). That reads like a recommendation
to change for no reason. When the CURRENT version already fits every checked mod, say instead: "Your mods
already fit Minecraft <current> - there is nothing you need to change." and show the other versions below as a
neutral list ("Other versions that also fit"), with no "Best match" badge and no pre-selected row. When the
current version has problems, keep today's behaviour. Pure helper + tests.

=== JOB 3: the confirm step must list EVERY mod that will be turned off ===
Seen in the real app: the confirm step for 1.21.10 promised "No build for 1.21.10 (1): Just Enough Items", but
the switch turned off 3 mods - two more because "its own file says it can't run on 1.21.10" (Client Side Crystals,
Marlow's Crystal Optimizer). The result screen was honest but the promise before was incomplete. Before the
confirm step, run the same local file checks that switchVersion applies (the jar's own Minecraft requirement
against the target version) and put those mods in the same "will be turned off" group with their reason ("its
own file says it can't run on 1.21.10"). The count in the group, the sentence and the result must always match.
Test: fake advice where Modrinth lists a build but the jar's own range excludes the target version.

=== JOB 4: stale label right after "Update mods to fit" ===
After the yellow "Update mods to fit" button finishes, its label still shows the old count (e.g. "(2)") until the
page is refreshed. Re-check and repaint it (or hide it) as soon as the operation ends. Small test of the
repaint decision.

When done: push, update DECISIONS_AND_TEST_PLAN.md (what changed, files, test count, a numbered PASS/FAIL plan
for the desktop window), and tell me (a) what you could not test, (b) every file you touched.
```
