Three small-to-medium jobs, all scoped already — don't re-investigate from
scratch, the groundwork below is accurate (checked directly against the
current code before writing this). Read this whole file first.

## Job 1: wire skin rename (small)

The backend is fully done and already working: `skin:libraryRename` is
registered in `src/main/main.js` and exposed as `window.reminth.
skinLibraryRename(id, name)` in `src/main/preload.js`. Nothing calls it.

In `src/renderer/features.js`, `loadSkinLibrary()` (around line 1729) builds
each skin tile via `skinTile({...})`, which already takes an `onDelete`
callback that adds a trash icon (see `skinTile`'s definition a bit above
line 1680, the `if (onDelete)` block). Add a matching rename control the
same way: a second icon button (pencil/edit, pick whatever icon id already
exists in the icon sprite — check what's used elsewhere, e.g. `#i-edit` or
similar) that prompts for a new name (a simple inline text input replacing
the tile's label, or a small modal via the existing `openModal` helper —
match whatever's more consistent with the delete button's UX) and calls
`window.reminth.skinLibraryRename(s.id, newName)`, then refreshes the tile
list. Don't touch the "Editing skin" modal (Apply/Save skin) — that flow
already works correctly and isn't part of this job.

Test live: rename a saved skin, confirm the new name persists after
switching pages and relaunching Reminth.

## Job 2: remove the dead catalog:checkUpdates handler (small)

`ipcMain.handle("catalog:checkUpdates", ...)` in `src/main/main.js` (around
line 484) has no caller anywhere in the renderer — the app uses
`content:checkUpdates` instead (a different, actually-used handler; don't
touch that one). Confirm this yourself with a fresh grep across
`src/renderer/*.js` for `catalog:checkUpdates`/`checkForUpdates` before
deleting, in case something calls it indirectly that a quick check misses.
If it's confirmed unused, delete the handler and, if `modrinth.
checkForUpdates` (the function it calls) has no other callers either,
remove that too. If anything else does reference it, leave it and say so in
the report instead of guessing.

## Job 3: mod version picker + dependency preview (the real one)

Right now, adding a mod from Discover always silently installs whatever
`installContent` in the main process picks as "best version" — there is no
UI to see or choose a specific version, and no dependency preview before
installing. The backend for both already exists and works, it's just never
called from the UI:
- `window.reminth.getCatalogProjectVersions(idOrSlug, filters)` →
  `catalog:projectVersions` → `modrinth.getProjectVersions()`
- `window.reminth.getCatalogDependencies(idOrSlug)` →
  `catalog:dependencies` → `modrinth.getProjectDependencies()`

There's already a working pattern to copy: `installModpackFlow()` in
`src/renderer/features.js` (around line 493) opens a modal before
installing, using `openModal`. Follow that same shape for mods:

1. Where a mod's "+" / install button is clicked (feeds into
   `installProject()`, around line 452), add a step before calling
   `installContent`: fetch `getCatalogProjectVersions` for that project,
   filtered to the active instance's loader + Minecraft version (check how
   `installContent` currently filters/picks "best" server-side — mirror
   that filter client-side so the list only shows versions that would
   actually work on this instance, not every version ever published).
2. Show a modal: a version list (name, MC version(s), loader(s), release
   type — release/beta/alpha, published date) defaulting to whatever would
   have been auto-picked before (so a user who doesn't care can just hit
   Install same as today), plus a dependency preview fetched via
   `getCatalogDependencies` (required/optional mods this version needs,
   clearly marked which are already installed on this instance vs. which
   would also get pulled in).
3. On confirm, install the chosen version specifically — check
   `installContent`'s existing signature/IPC call to see if it already
   accepts an explicit version id or version-file param; if not, that's a
   small main-process change needed too (don't skip it just because it's
   inconvenient — the picker is pointless if it can't actually act on the
   choice).
4. Don't make this mandatory friction for every single install — a
   reasonable default (skip the modal, install best-match immediately) is
   fine for a plain click, IF you add some clear affordance for "choose
   version" (e.g. a small dropdown-arrow or "..." next to the main +
   button, or a right-click option) rather than forcing every install
   through an extra modal. Use your judgment on the exact affordance, but
   the fast path for someone who doesn't care must stay just as fast as it
   is today.

Test live: install a mod through both paths (default quick-install, and
explicit version pick), confirm the picked version is what's actually
installed on disk (check the jar filename/version in the instance's Mods
tab), and confirm a mod with real dependencies shows them correctly in the
preview.

## Before you finish

Commit and push, ideally one commit per job. Update `REMINTH_STATE.md`:
what changed for each job, live test results for all three, and for job 2
specifically state clearly whether the handler was actually removed or left
in place (and why, if left).
