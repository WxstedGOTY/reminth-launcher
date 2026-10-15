# Hidden preview: look at the launcher without touching the owner's screen or data

Made 15 Oct 2026 while the owner's Minecraft and installed Reminth were open. Use it for any "how does the UI look"
check. Nothing here is packaged (package.json `build.files` only takes `src/`, `assets/`).

What `hidden-hook.js` does (loaded with `electron -r`):
- its own Chromium profile (`PREVIEW_PROFILE/userdata`) and **no single-instance lock** - without this the dev app
  shares the installed Reminth's lock, quits, and the installed Reminth jumps to the front of the owner's game;
- the window opens **off-screen, without focus, without a taskbar button** (`showInactive` at x = -6000);
- `PREVIEW_PROFILE/size.txt` containing `"<w> <h>"` resizes it (the app then zooms its UI to fit, like a real small
  window - see `main.js` fitZoom);
- the protocol registration is a no-op.

Reminth's own data (settings, instances, accounts) follows `os.homedir()` (`src/main/paths.js`), so setting
`USERPROFILE` to a scratch folder gives the preview its own empty `%APPDATA%\Reminth` - **never the owner's**.

```bash
P=/path/to/scratch/preview; mkdir -p "$P/home"
USERPROFILE="$P/home" PREVIEW_PROFILE="$P" PREVIEW_W=1440 PREVIEW_H=900 \
  node_modules/.bin/electron -r tools/preview/hidden-hook.js . --remote-debugging-port=9333   # run in the background
node tools/preview/cdp.js 9333 eval "$(cat tools/preview/fake-home.js)"    # pretend to be signed in (design numbers)
node tools/preview/cdp.js 9333 shot out.png "switchPage('discover'); await new Promise(r => setTimeout(r, 1500))"
node tools/preview/cdp-console.js 9333 10                                  # reload and print any errors
```

Notes:
- The off-screen window gets no animation frames, so the loading screen never ends by itself - `fake-home.js`
  removes it. Real windows are not affected.
- `window.reminth` (the preload API) can't be replaced from the page; `fake-home.js` calls the painting functions
  directly (`updateHomeStatRow`, `paintTiers`, `quickTile`). Run it again after ~1 s if a real look-up repainted.
- Stop it afterwards: find the `electron.exe` whose command line has `-r ...hidden-hook.js` and end that process
  tree. The installed app is `Reminth.exe` - never touch it.

## The owner's LIVE preview (visible, refreshes by itself)

Desktop shortcut **"Reminth Live Preview"** -> `tools/preview/live.cmd` -> `electron -r tools/preview/live-hook.js .`
- A normal window titled "Reminth - LIVE PREVIEW" that runs the code in this folder, next to the installed Reminth.
- Its own data: `%USERPROFILE%\Downloads\reminth-live-preview` (home + Chromium profile). The first start copies only
  the small files Home's stats need from the real `%APPDATA%\Reminth` (`live-copy.ps1`: settings.json, servers.dat,
  options.txt, each world's level.dat/icon/stats, server stats) - never writes to the real folder. Delete that folder
  to start the preview fresh.
- Any change under `src/renderer` reloads it; a change under `src/main` or `assets/icons` restarts it.
- DevTools port 9440 (`CDP_PORT=9440 node local-notes/cdpx.js eval ...`) to check what it shows.
- The owner signs in there himself once (Reminth account + Microsoft); its sign-in is separate from the real Reminth.
