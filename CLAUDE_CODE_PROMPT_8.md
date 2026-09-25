Final cleanup round. Five jobs, ordered by priority. Read this whole file first.
REMINTH_STATE.md (written after round 9) has the accurate current state — check it
before touching anything, its "What's left" section is the source of truth, not memory.

## Job 1: Forge 26.3 and NeoForge 26.3 — do they actually launch? (do this first)

These were never confirmed launching by anyone, human or sandbox — REMINTH_STATE.md
lists both as UNTESTED. This matters more than anything else here: if the launcher
can't actually launch two of its four supported loaders, that's the real bug.

Test both instances (`forge-26-3-ff87`, `neoforge-26-3-0050`) the same way ReminthHUD
launches were verified in earlier rounds: sandboxed dev-mode Electron, real Mojang/
Forge/NeoForge infrastructure, watch for an actual joinable world or at minimum the
title screen. Do NOT test against the real installed app or the user's real account
session — same isolation rule as always (`USERPROFILE`/`APPDATA` pointed at a scratch
home). If either fails, capture the exact error/log and say so plainly — don't paper
over a launch failure by calling it "started" if it crashed.

## Job 2: PAGE_META gap (small, one-line-per-page fix)

`renderer.js`'s `PAGE_META` has no entries for `#discover`, `#plus`, `#captures`,
`#streamer`, so `switchPage` returns early and the rail links to them do nothing.
Confirm this is still true with a fresh grep (don't trust the old note blindly), then:
- If a page has real, working content behind it already, add its `PAGE_META` entry
  so the rail link works.
- If a page is a stub with nothing built yet (this may be true for `captures` and
  `streamer` especially), leave it out of `PAGE_META` on purpose, but make the rail
  link show a "Soon" state instead of silently doing nothing when clicked — same
  pattern already used elsewhere in the UI (grep for "Soon" to match the pattern).
Say in the report which pages got real entries vs. which got the "Soon" treatment,
and why.

## Job 3: silent refresh error handling

`main.js`'s `refreshSession` has a bare `catch {}` — a failed token refresh currently
fails completely silently. At minimum, log the error to the existing log file (match
whatever logging pattern `minecraft.js` already uses for launch errors) so a future
"why won't it sign in" report has something to go on. Don't change the actual
refresh/retry behavior, just stop swallowing the error silently.

## Job 4: repo and local cleanup

- `assets/mods/wxhud-1.0.0.jar` (pre-rename HUD jar) is dead weight in the repo —
  confirm nothing references it (grep for `wxhud-1.0.0`), then delete it.
- `%APPDATA%\Reminth\instance\mods\` (singular `instance`, not `instances\<id>\`) is a
  stale leftover folder — confirm the real launcher never reads from it (grep
  `minecraft.js` for how it resolves the mods path), then delete its contents so it
  stops being confusing. Leave `instances\` (plural) alone, that's the real one.
- `Downloads\reminth-launcher-push\` is a redundant second copy of the renderer —
  confirm the real repo at `Downloads\reminth-launcher\` has everything from it (diff
  the renderer files), then tell the user it's safe to delete by hand. Don't delete a
  folder outside the repo yourself — just confirm and report.
- Check whether the `brace-expansion` lockfile pin mentioned in past rounds is still
  needed (`npm audit` / check the advisory it was pinned for) and either remove the
  pin if it's no longer needed or leave a one-line comment in `package.json` saying
  why it's still there.

## Job 5: auto-updater end-to-end (do this LAST, only if jobs 1-4 are done and clean)

This needs a real new GitHub release newer than what's currently published, so it's
riskier than the others — only do it if everything above is solid.
1. Bump the version in `package.json` (patch bump, e.g. 1.1.0 → 1.1.1).
2. `npm run dist` for a fresh installer.
3. Create a new GitHub release with that version tag, upload the `.exe`, `.blockmap`,
   and `latest.yml` from `dist\`.
4. Report what you did but do NOT try to verify the live auto-download/install flow
   yourself — that needs an already-running OLDER installed build checking for
   updates, which only a human running the real app can observe. Say plainly in the
   report that this last step (confirm the update banner shows up, restart installs
   it) still needs a human to watch it happen.

## Before you finish

Commit and push, one commit per job. Update REMINTH_STATE.md: Forge/NeoForge launch
results (this is the one that matters most — be precise about pass/fail and why),
PAGE_META decision per page, refresh logging change, what got deleted/cleaned up and
what's left for the user to delete by hand, and the new release version/tag if job 5
was done.
