# Reminth app icon

**8 Oct 2026 (owner: "the icon has a background instead of the icon only"):** the app now uses the see-through mark -
`source/reminth-mark.svg`, the master without its dark rounded tile, frame and big haze. `tools/make-icon-mark.js` makes
it and, from it, `reminth.ico` (16-256 px, rendered from the SVG - the delivered hand-tuned small sizes had the tile),
`source/reminth-mark-1024.png` and the site icons. Run: `node_modules/.bin/electron tools/make-icon-mark.js`.

| File | Used by |
|---|---|
| `reminth.ico` | Windows: the window/taskbar icon (`src/main/main.js`), the .exe icon, the installer, the uninstaller and the shortcuts (`package.json` `build.win.icon`, `build.nsis.*Icon`) |
| `reminth.icns` | macOS - kept for later; not packaged (Reminth is Windows only today, excluded in `build.files`) |
| `source/reminth-icon-master.svg` | The delivered source (with its tile). Not used directly any more |
| `source/reminth-mark.svg` | The see-through mark: the app itself (loading screen, left rail, sign-in card, the ReminthHUD card) and `site/favicon.svg` |
| `source/reminth-icon-master-1024.png` | The 1024 px master picture (reference; not packaged) |

Not delivered yet: `linux/hicolor/*` and the transparent mark (`reminth-mark-1024-transparent.png`). Nothing needs them
today (no Linux build, no tray icon).

The brand colours are the `--brand-*` variables at the top of `src/renderer/styles.css` (all values read from the SVG).
`--brand-core` (#ff4a1c) is the default accent; errors use `--rose` (a cool pink-red, deliberately far from it).
