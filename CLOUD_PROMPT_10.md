# Prompt 10 for the code-writing window: instances you can manage - right-click menu, reorder, no surprise copies

Model: Opus 5.5, effort high (many UI paths + a persisted order). Send when the desktop window is idle. Send Prompt 11 only AFTER this one is finished and pushed.

---

```
Read CLAUDE.md, CLAUDE_CODE_HANDOFF_10.md sections 0-1 (the rules) and DECISIONS_AND_TEST_PLAN.md. Pull main
first. You cannot run Electron: say plainly what you could not test. npm test after each job, commit after each
finished job, push to main at the end, then update DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says. Do NOT build,
do NOT bump the version, do NOT touch the performance-pack code, buildJvmFlags, safe-mode or memory code, or the
privacy/terms text (nothing here leaves the PC; if you disagree, list the sentence in the hand-off file).
Rules that matter here: no innerHTML; one confirmation style (reuse confirmModal/openModal); every async click
captures the instance id at click time, guards double clicks, re-enables in finally, toasts friendlyError().

Owner feedback (a real tester): "stop creating me a million instances that I can't delete simply. I want to
right-click an instance and see an easy Delete button and other settings, and move instances around like from
the bottom to the top. Make it less complex, someone new gets confused."

Today: the left rail (renderer.js renderRail) shows one round button per instance; clicking opens the
instance page. There is NO right-click menu and NO way to reorder. Delete exists only in the three-dot menu
inside the instance page (#instMoreBtn / #instDeleteBtn), and the default instance "Reminth" (id "reminth")
can't be deleted. Instances are created by: the New instance dialog, Discover's server Play ("Make an
instance for <server>?" - already asks), and the version advisor's "copy to version" (compat:copyToVersion
-> migrate.copyToVersion) which makes a NEW instance every time.

=== JOB 1: right-click menu on every instance (rail AND Library > Instances cards) ===
 a. Right-click (and the keyboard Menu key / Shift+F10 on a focused instance button) opens a small menu next to
    the pointer, same look as the existing dropdowns (.sort-dd / .dd-item), closes on Esc / outside click /
    scroll / window blur, never goes off screen, and is keyboard operable (arrows, Enter).
 b. Entries, in this order, plain words:
      Play                      (uses the explicit-instance runPlay; disabled while it runs/installs)
      Open                      (selectInstance(id, true))
      Rename...                 (small modal, name field only; reuse the instances:update path; not while running)
      Open folder               (existing openFolder)
      Move up / Move down / Move to top / Move to bottom   (JOB 2; keyboard users need these)
      Delete...                 (red, bin icon, last entry, separated by a line)
    The default "Reminth" instance: Delete is shown disabled with the line "This is your main instance - it
    can't be deleted." (don't hide it; hiding is what confuses people). A running instance: Rename/Delete
    disabled with "Close the game first."
 c. Delete... uses the existing delete flow and confirmation but the text now says WHAT is deleted: "<name> -
    N worlds, X.X GB. Everything inside it is deleted for good (worlds, mods, screenshots). Your other
    instances are not touched." Compute worlds/size in the MAIN process (new IPC instances:summary(id): world
    count from saves/, total bytes with a time cap of ~1.5 s and "about" when capped; never follow symlinks
    or junctions out of the folder). After deleting: select a sensible instance (the hero/last played), toast
    "<name> deleted." and refresh rail, Library, Home. Keep the running guard in main.
 d. The same menu opens from the three-dot button on the instance page and from a Library card, so there is
    one menu implementation (one function, one place).
 Tests: pure helpers (menu items for running/default/normal instance, summary formatting) + the IPC with a
 temp folder (world count, size, symlink not followed, cap).

=== JOB 2: move instances around (top <-> bottom) ===
 a. Drag and drop in the rail: pick an instance button up, a thin insertion line shows where it will land, drop
    to place it. Works with the mouse; a dragged button is dimmed; Esc cancels; dropping outside the rail
    cancels. Reordering is only about the list - it never changes which instance is selected or running.
 b. The order is saved: new IPC instances:reorder(idsInNewOrder) in main.js -> instances.js, atomic write of
    the registry (same queue/lock as the other writes), validating the ids: must be exactly the current set
    (unknown or missing ids -> refuse and keep the old order); the default "Reminth" instance may move too.
    Unknown/new instances created later append at the END (not the top) - check where create() puts them today
    and keep that. Library > Instances keeps its own sort control; its default sort becomes "My order" (the rail
    order), the other sorts stay.
 c. The menu entries Move up/down/top/bottom (JOB 1) call the same reorder; the first/last items disable the
    impossible ones.
 Tests: reorder validation and persistence (round trip through readAll), append-at-end for new instances, the
 pure "move item" helper (top/bottom/up/down/drag drop index).

=== JOB 3: no surprise instances, and an easy way back ===
 (Owner clarification: the instances that confuse people most are the ones the mod-sync / "Which Minecraft
 version" dialog makes - Prompt 11 redesigns that dialog, so here only build the shared pieces: the one
 confirmation helper, "use an existing instance instead", madeFor, the Undo toast and the delete menu; make the
 advisor's current copy step call them so it is already safe if Prompt 11 is delayed.)
 Every place that creates an instance must tell the player first, in the same plain pattern, and must be easy
 to undo. Audit all creation paths (search createInstance( / instances.create( / compat:copyToVersion /
 mrpack import) and make them consistent:
 a. Before creating anything the player did not explicitly ask for in a "New instance" dialog (server Play,
    advisor copy-to-version, anything else you find), show ONE confirmation: "Reminth will make a new
    instance: <name> - Minecraft <v> <loader>. Your other instances are not changed." with the buttons
    "Create" and "Cancel". Server Play already does this - keep its wording but use the same helper.
 b. Reuse before creating: if an existing instance already has the same Minecraft version and loader (and for
    a copy: the same source), offer "Use <that instance>" as the first choice and "Make a new one" second.
    Never create two instances with identical name+version+loader in one go: add " (2)" like the existing
    slug logic does for ids, and say so in the dialog.
 c. After an automatic creation show a toast with "Undo": it deletes the instance again, ONLY if it was never
    played and holds no worlds the player made (check saves/ is empty or only holds what the copy carried;
    when in doubt the Undo button isn't shown). The Undo window is the toast's lifetime (~10 s) plus
    "Delete" in the new right-click menu afterwards.
 d. Mark automatically made instances in the instance page header with a small grey line "Made for <server /
    copy of X>" (store a short `madeFor` string in the registry, sanitized, max 60 chars, shown with
    textContent only).
 e. Library > Instances shows "Last played" and the size on disk (from instances:summary, computed lazily when
    the page is open, cached for the session) so the player can see which instances are old and big.
 Tests: the reuse decision (pure), madeFor sanitizing, the Undo eligibility rule (never played / empty saves /
 carried files), and that confirm-before-create is called on every creation path (stub the modal).

Also: keep everything working with 1 instance (the menu still opens; Delete disabled for the main one) and with
30 (the rail scrolls; dragging near the edge auto-scrolls it).

When done: push, update DECISIONS_AND_TEST_PLAN.md (what changed, files, test count, decisions with
recommendations, a numbered PASS/FAIL plan for the desktop window: right-click on the rail / Library / the
three-dot menu, delete a throwaway instance with a world and read the confirmation numbers, drag to reorder and
restart Reminth to see the order kept, create via server Play and the advisor and see the confirmation + Undo,
main instance delete disabled), and tell me (a) what you could not test, (b) every file you touched.
```
