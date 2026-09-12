# Reminth Launcher

A custom Windows Minecraft launcher: sign in with your own Microsoft
account, it downloads vanilla Minecraft 26.2 + Fabric + WxHUD automatically,
and launches the game.

## Honest status — read this first

I (Claude) wrote all of this code but **could not run the actual app**.
This cloud sandbox's network policy blocks `registry.npmjs.org` for
package installs (confirmed: even `npm install lodash` gets a 403), and
there's no shell access into your Windows PC from here (unlike the wxhud
mod, which I built *and* ran *and* watched render in-game).

What I *could* do without npm: I dropped the `node-fetch` dependency
entirely (Node 18+ ships `fetch` built in, no package needed), and wrote
real unit tests (`test/minecraft.test.js`, `node --test`, zero npm
packages required) for the pure-logic pieces — Fabric/vanilla profile
merging, per-OS library filtering, and Maven-coordinate resolution. All 8
pass. That's real, not a claim — run `npm test` (or just `node --test`)
yourself to see it. Everything else — the actual Electron window, the
Microsoft device-code sign-in round trip, the real download/launch — is
written against the documented protocols but genuinely untested. Budget
time to run it and fix whatever breaks — most likely candidates, roughly
in order of "probably needs fixing":

1. **`MS_CLIENT_ID` in `src/main/config.js`** — placeholder, see setup below. Nothing works without this.
2. **`WXHUD_UPDATE_MANIFEST_URL`** — placeholder pointing nowhere. Needs a real URL once WxHUD is hosted somewhere (your site, GitHub releases, whatever) serving JSON like `{"version":"1.0.0","url":"https://.../wxhud-1.0.0.jar"}`.
3. **JDK download URL in `src/main/java.js`** (`aka.ms/download-jdk/...`) — I'm fairly confident in this alias but it's exactly the kind of thing that silently changes; verify it actually downloads a zip and not an error page.
4. **Argument merging in `minecraft.js` (`mergeProfiles`)** — this is the part of any custom launcher most likely to need tweaking version-to-version. If the game crashes on launch with a `ClassNotFoundException` or missing-argument error, this is where to look first.
5. **Fabric's mod loading `KnotClient` mainClass** — should be right, but confirm against `https://meta.fabricmc.net/v2/versions/loader/26.2/0.19.5/profile/json` once that endpoint is reachable, since Minecraft 26.2 is very new.

## Setup

### 1. Azure app registration (required, ~5 minutes, free)

Every third-party Minecraft launcher needs its own Microsoft app ID —
this is what makes the "Sign in with Microsoft" button work.

1. Go to https://portal.azure.com -> **Azure Active Directory** -> **App registrations** -> **New registration**
2. Name: `Reminth` (or whatever)
3. **Supported account types**: "Personal Microsoft accounts only"
4. Redirect URI: leave blank (not needed for device code flow)
5. Register, then copy the **Application (client) ID** from the overview page
6. Put it in `src/main/config.js` as `MS_CLIENT_ID`, or set env var `REMINTH_MS_CLIENT_ID`

No client secret needed — this is a public client (device code) flow, same as MultiMC/Prism.

### 2. Install & run

```
npm install
npm test    # pure-logic unit tests, already passing, sanity-check your environment too
npm start
```

### 3. Package the Windows installer

```
npm run dist
```

Outputs a `.exe` NSIS installer to `dist/`.

## Project layout

```
src/main/main.js        Electron entry point, IPC wiring
src/main/msAuth.js       Microsoft -> Xbox Live -> XSTS -> Minecraft auth (device code flow)
src/main/minecraft.js    Version resolution, download, Fabric merge, launch
src/main/java.js         Downloads a private JDK 25 (never touches system Java)
src/main/store.js        Encrypted-at-rest account/refresh-token storage
src/main/config.js       <-- fill in MS_CLIENT_ID and WXHUD_UPDATE_MANIFEST_URL here
src/renderer/            UI (glassmorphism, charcoal + electric teal, per the brand doc)
```

## What this deliberately does NOT include

No targeting/aimbot, ESP, or packet-manipulation modules. Those were
scoped out — see the conversation this was built from. This is a clean
launcher + cosmetic HUD overlay only.
