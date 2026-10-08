# Reminth app icon

Finished files, used exactly as delivered (the 16/24/32 px pictures in the .ico are hand-tuned redraws: never resample,
re-export or "optimise" them).

| File | Used by |
|---|---|
| `reminth.ico` | Windows: the window/taskbar icon (`src/main/main.js`), the .exe icon, the installer, the uninstaller and the shortcuts (`package.json` `build.win.icon`, `build.nsis.*Icon`) |
| `reminth.icns` | macOS - kept for later; not packaged (Reminth is Windows only today, excluded in `build.files`) |
| `source/reminth-icon-master.svg` | The source. Used by the app itself (loading screen, left rail, sign-in card, the ReminthHUD card) and copied to `site/favicon.svg` |
| `source/reminth-icon-master-1024.png` | The 1024 px master picture (reference; not packaged) |

Not delivered yet: `linux/hicolor/*` and the transparent mark (`reminth-mark-1024-transparent.png`). Nothing needs them
today (no Linux build, no tray icon).

The brand colours are the `--brand-*` variables at the top of `src/renderer/styles.css` (all values read from the SVG).
`--brand-core` (#ff4a1c) is the default accent; errors use `--rose` (a cool pink-red, deliberately far from it).
