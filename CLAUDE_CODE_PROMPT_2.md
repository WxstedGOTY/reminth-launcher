New instructions, not a repeat of anything already done. Read this whole
file before doing anything — some of it wasn't picked up last time.

## First: record real test results that already happened

The user personally ran these tonight, live, on this machine. None of this
made it into `REMINTH_STATE.md` yet. Add it now, labelled VERIFIED with "user
ran it live" as the evidence, before doing anything else:

- Fresh device-code sign-in: VERIFIED pass. Signed out, signed back in with
  the real device-code flow, worked.
- Fabric: VERIFIED pass (launched clean).
- NeoForge: VERIFIED pass (launched clean).
- Quilt: VERIFIED pass (launched clean).
- Multiplayer join on donutsmp.net, from a Quilt instance: VERIFIED pass.
  This confirms the full Mojang session-auth chain works for real, not just
  local/offline launches.

## Fix #1: sign-out doesn't gate the app

Confirmed real by the user: signing out correctly clears the account (skin
disappears, skin selector empties, UI shows logged out) — that part is
fine. The bug: everything else stays fully visible and usable while signed
out — instance list, worlds, mods, servers, all still Browse-able. On a
shared PC, someone else can see and use your instances after you've logged
out.

Fix it: when signed out, show a "sign in to continue" state instead of the
normal home/library screens — reuse whatever gating already exists for
before-anyone-has-ever-signed-in, don't build a second mechanism.

## Fix #2: launcher opens windowed, should open maximized

Still not done. Change the main window to open maximized by default —
almost certainly a `BrowserWindow` option in `src/main/main.js`.

## Then test what's still untested

- Forge: launch an instance, confirm it boots without crashing. Nobody has
  tried this yet.
- ReminthHUD: check whether it actually renders in-game (press H) on the
  NeoForge and Quilt instances that already launched tonight.

## Before you finish

Commit and push everything. Update `REMINTH_STATE.md` with all of the
above — the newly-recorded live results, both fixes, and the Forge/HUD test
results. End it with a short "what's left" list for next time.
