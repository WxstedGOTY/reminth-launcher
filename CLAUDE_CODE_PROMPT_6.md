Small follow-up, not a new audit. Read this whole file first.

## What's already done, don't redo it
`Downloads\wxhud\wxhud\src\main\resources\fabric.mod.json` already has the fix:
`"fabricloader": "*"` (was `">=0.19.5"`). That's the correct fix — Quilt Loader
0.30.1 only exposes fabric-loader-compat version 0.19.3, which failed the old
`>=0.19.5` check and crashed Minecraft on launch with:
"ReminthHUD requires at least version 0.19.5 or any newer version of
fabricloader, but only a different version is present: 0.19.3."

The edit was saved but never rebuilt or deployed. Nothing else has changed.

## What's left

1. Rebuild: `cd Downloads\wxhud\wxhud` then `gradlew build`. Confirm
   `BUILD SUCCESSFUL` and a fresh `build\libs\reminthhud-1.0.0+26.3.jar`
   (newer timestamp than the source edit).
2. Confirm the fix actually landed in the built jar: unzip it and check
   `fabric.mod.json` inside says `"fabricloader": "*"`, not `">=0.19.5"`.
3. Copy that jar to BOTH places (both currently have the stale broken one):
   - `Downloads\reminth-launcher\assets\mods\reminthhud-1.0.0+26.3.jar`
   - `%APPDATA%\Reminth\instances\quilt-26-3-49e0\mods\reminthhud-1.0.0+26.3.jar`
4. Retest live: launch the Quilt 26.3 instance. Confirm it does NOT crash
   (no "Minecraft failed to launch" dialog), reaches the title screen, and
   pressing H in a world shows the HUD. Also re-launch the Fabric 26.2
   instance once, just to confirm nothing there regressed (it shouldn't have
   — different jar, untouched).
5. Since `assets/mods` changed, the installed app's bundled copy is stale
   too until the next `npm run dist` + reinstall. Rebuild and reinstall the
   Reminth installer only if that's quick given the current locked-file
   situation; if it's blocked the same way as previous rounds, it's fine to
   leave the exe as-is and just note it in the report — the in-place instance
   fix (step 3) is what actually matters for playing right now.

## Before you finish
Commit and push (the `wxhud` project isn't a git repo, only the jar landing
in `assets/mods` needs to be committed in `reminth-launcher`). Update
`REMINTH_STATE.md`: rebuild result, confirmation the fix is in the jar, both
copy targets updated, and the live retest result for both Quilt 26.3 and
Fabric 26.2.
