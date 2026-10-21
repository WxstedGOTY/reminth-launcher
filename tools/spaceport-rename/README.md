# Tools from the Reminth -> Spaceport Launcher rename (16-17 Oct 2026)

Kept so the next window doesn't rebuild them. All are plain Node/PowerShell scripts; run from the repo root.

| file | what it does |
|---|---|
| `rename-rules.js` | The wording rules: `ReminthHUD` -> Spaceport HUD, `Reminth+` -> Spaceport+, "Reminth <version>" -> Spaceport Launcher <version>, everything else -> Spaceport. |
| `find-visible.js [--rewrite] files...` | Finds (or rewrites) the old name ONLY inside JS string/template literals - never comments, ids, paths or log lines. Needs `RULES=path/to/rename-rules.js` or run from this folder. |
| `rename-html.js file.html [--keep "text"]...` | Same for HTML text (not `src=`/`href=`, scripts, styles, comments). `TOUCH_CONTENT=1` also renames `<meta content=...>`. |
| `rename-java.js [--dry] files...` | Same for the in-game mods' Java sources and the mods' JSON (skips lines that log). |
| `build-mods.ps1` | Builds ALL 20 bundled mod jars (HUD 1.6.1 + home screen 1.0.10, 10 each) into `%TEMP%\spaceport-mod-jars`. Bump `$hud` / `$homeV` and the `$version` in `hud-1.21\build-all.ps1` / `home-1.21\build-all.ps1` first. ~10 min. |
| `compare-jars.js <dir>` | Compares new jars with the ones in `assets/mods` (same Minecraft range / needs, new version and name). |
| `game-check.js <mc version> [panelAtSeconds]` | Installs a version through the launcher's own `minecraft.js` with the HUD + home screen, starts a REAL game with a pretend offline player ("Bench"), opens the G panel by `-Dreminthhud.testOpenPanel`, takes window-only pictures, prints the log. Run with `USERPROFILE` pointing at a scratch home (it refuses otherwise). Never while the owner plays. |
| `shot-html.js file.html out.png w h` | Renders a local HTML file off-screen with Electron into a PNG (how `site/og.png` was made from `og.html`). |
| `og.html` | The Night-look link-preview picture (1200x630) of the website. |

Pitfalls learned: Git Bash eats backslashes and `$` in inline `node -e` - write scripts with the Write tool; `$home` is a
reserved PowerShell variable; several repo files are CRLF (keep them); `git grep`-style searches must skip
`node_modules`, `build`, `dist`, `release-*`.
