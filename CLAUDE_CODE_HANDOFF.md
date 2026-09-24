# Reminth Launcher — handoff to Claude Code

This is a from-scratch Electron Minecraft launcher (own branding, own auth,
own instance system — not a fork of Modrinth App/Prism/etc). UI is
considered done. This doc is the state of play for the next phase: **make
the real functionality solid**, not build more screens.

Read this whole file before touching anything. It exists so you don't
re-discover what's already been checked tonight and waste a cycle re-testing
something that's already confirmed working or already known broken.

## Where things live

- **Repo / working copy on this machine:** `C:\Users\kolijos\Downloads\reminth-launcher`
  — real git clone, real `node_modules` (electron, electron-builder already
  installed). This is the copy to work in.
- **GitHub:** `github.com/WxstedGOTY/reminth-launcher`, default branch
  `main`. **The remote is stuck at an old commit (`446dbdf`)** — several
  local commits on top of it (`fe297f7`, `39b1a4c`, and more) have never
  been pushed, because the cloud assistant session that made them hit a
  proxy/auth block on `git push` all session and could never get past it.
  Your push should work fine from here since you're running with the user's
  own real git auth, not through that sandbox. **Push those commits before
  doing anything else**, or you'll be working on top of a repo that's
  missing recent history and may get confused about what's already done.
- **Build:** `npm run dist` (wraps `electron-builder --win nsis`), or the
  existing `build-dist.bat` in the repo root. Output lands in `dist\`,
  produces `Reminth-Setup.exe`. Per-user NSIS install (no admin/UAC needed)
  — `AppData\Local\Programs\Reminth`. There's also a stale, broken
  `C:\Program Files\Reminth` install from an earlier attempt (0-byte
  `app.asar`, ignore/eventually delete it) and a duplicate desktop shortcut
  in `C:\Users\Public\Desktop\Reminth.lnk` pointing at that broken install —
  harmless but confusing, the user knows about it.
- **Website / download page:** `github.com/WxstedGOTY/kyma-portfolio` is
  unrelated (a different project, ignore it if you see `DEPLOY.md` for it
  anywhere). The Reminth download button already points at GitHub's stable
  `releases/latest/download/Reminth-Setup.exe` URL, so a new release just
  needs an asset uploaded and marked latest — no site code changes needed.

## The one big finding from tonight: sign-in is NOT actually blocked

`src/main/config.js` and the header comment in `src/main/msAuth.js` both
claim the Azure AD app registration (`MS_CLIENT_ID`) is stuck in Microsoft's
review queue and the final `login_with_xbox` call against
`api.minecraftservices.com` 403s with "Invalid app registration" until
approved.

**That comment is stale.** Tonight, on this machine, with this exact build,
clicking Play on the existing signed-in account (`unpurfectt`) launched real
Minecraft cleanly: 86 mods loaded, Fabric API + ReminthHUD installed, OpenGL
initialized, `Setting user: unpurfectt` in the log, zero crashes, and the
actual `javaw.exe` game window took foreground. Whatever the review-queue
situation was when that comment was written, it is not currently blocking
this account.

**What's NOT yet verified — do this first, it's the actual open question:**
a completely fresh account doing the device-code sign-in flow for the first
time. Tonight's test used an already-cached session from a prior login, so
it proves the launch pipeline works but doesn't prove a brand-new
`login_with_xbox` call succeeds. To test:

1. Sign out in Reminth (or wipe whatever file `store.js`/`entitlements.js`
   cache the account in — check those two files for where the token
   lives).
2. Sign in again with a device code, either the same account or a second
   Microsoft account if one's available.
3. Watch whether it reaches Minecraft Services or still 403s.

If it works, delete the stale warning comments in `config.js`/`msAuth.js`
so nobody chases this ghost again. If it still 403s for a *fresh* login
specifically, that's a real bug to chase (session/token caching bug, not
actually an Azure approval issue — since we now know the app ID itself
isn't blocked).

## What's real vs. what's untested (don't waste time re-verifying the real parts)

Read through the codebase tonight — this is not a stub/demo app. These are
genuinely implemented, not fake data:

- `src/main/msAuth.js` — full MS → Xbox Live → XSTS → Minecraft Services
  device-code flow.
- `src/main/minecraft.js`, `forge.js`, `loaders.js` — real version
  resolution and install logic for Fabric/Forge/NeoForge/Quilt.
- `src/main/java.js` — downloads the matching JRE per Minecraft version.
- `src/main/modrinth.js`, `mrpack.js` — real Modrinth API integration for
  mod browsing/install and modpack import.
- `src/main/instances.js` — multi-instance system, per-instance
  `playTimeMs` tracking (confirmed correct tonight after a UI bug where the
  home-screen lifetime total was showing one instance's time instead of the
  sum — fixed in `renderer.js`, see below).

What's **implemented but never proven end-to-end** because sign-in was
assumed broken until tonight:

- Forge/NeoForge/Quilt launches specifically — only Fabric was actually
  tested tonight (worked). Same test, other three loaders.
- Multiplayer: joining an actual server does a full Mojang session
  validation that a singleplayer launch doesn't. This is the strongest real
  test of the auth chain if you want certainty — has 4 saved servers
  already in the test account to try.
- ReminthHUD on a loader other than Fabric — code comments say per-instance
  HUD switching works "on any version that has a HUD build," implying not
  all versions/loaders have one yet.

## Known gaps, not bugs — decide whether to fix now or later

1. **No auto-updater.** `electron-updater` isn't even a dependency. Every
   release right now is: build the exe by hand, click through the NSIS
   installer yourself, manually delete+reupload the asset on the GitHub
   release page. That's the entire reason tonight's session burned a chunk
   of time on a stuck native file-picker dialog. If you're going to be
   iterating on fixes (which this phase implies), wire `electron-updater`
   against the GitHub releases feed early — it'll pay for itself after the
   second or third fix.
2. **No CI.** Builds only happen manually via `build-dist.bat` on this
   machine. Fine for a single-developer Windows-only app for now, just
   flagging it.
3. **Home screen "Time played" fix (already done, needs a rebuild to ship):**
   `src/renderer/renderer.js`, the `loadRecent()` function — `heroPlaytime`
   was showing whichever instance was active instead of summing
   `playTimeMs` across all instances. Fixed tonight, staged on this
   machine's copy of the file, **not yet in a build**. Roll it into your
   first rebuild rather than treating it as new work.

## Suggested order

1. `git pull`/reconcile and push the backlog of unpushed commits so GitHub
   matches what's actually on this machine.
2. Fresh-account sign-in test (see above) — this is the one real unknown.
3. If it passes: launch-test Forge, NeoForge, and Quilt instances, and try
   joining one of the saved multiplayer servers.
4. Wire `electron-updater` before you start iterating on whatever breaks in
   step 3 — you'll want it.
5. Fix whatever step 3 turns up. Roll in the `heroPlaytime` fix on your
   first rebuild.
6. Rebuild, install, and push a real release once you've got a green run
   across all four loaders.

## Ground rules carried over (still apply)

- Zero cheat functionality, ever. Not a request that's come up in this
  phase, but it's the standing constraint on this project.
- Never copy code or assets from other launchers (Prism, HeliosLauncher,
  Modrinth App, etc.) — read their public docs for reference (as
  `msAuth.js`'s own comments already do for the MS auth flow), don't lift
  their code.
- Real Modrinth data/names are fine to use — Reminth is a legitimate client
  for Modrinth's public API.
