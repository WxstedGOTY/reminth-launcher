# Overnight test scripts (4-5 Oct 2026)

Not part of the launcher. They drive Reminth's own `minecraft.js`/`content.js`/`modsSync.js` from node (no Electron window)
and start real games on this PC. They write into a folder next to themselves (`sweep-game/`, `modsweep-game/`, ...), which is
git-ignored. Windows only. They assume the repo is at `C:/Users/kolijos/Downloads/reminth-launcher` (edit `REPO` at the top).

| script | what it does |
|---|---|
| `sweep.js <list> <results> [loader] [full]` | installs and launches every version in the list, writes ok/fail per line. `full` = performance pack + HUD + home screen on |
| `modsweep.js <results> <N> loader@mc ...` | installs the N most downloaded Modrinth mods like Discover does, launches |
| `offline.js loader@mc ...` | install online once, then every `fetch` fails ("no internet"), install again, launch |
| `syncswitch.js loader FROM TO [N]` | mods for FROM, move to TO, `modsSync.applySync`, launch |
| `packmove.js loader FROM TO [slug ...]` | Reminth's own pack across a version change; lists duplicate mods afterwards |
| `fa_check.js` | the Fabric API download for every old version |

`capwin.ps1` takes a picture of ONE window (PrintWindow), never the desktop.

| `hometest/` | a throwaway mod: on the title screen it opens each screen, closes it like Back does, and prints PASS/FAIL that the Reminth title screen is back (build with gradle for 26.2, `-Pminecraft_version=26.3` and OptionsScreen with 2 arguments for 26.3) |
