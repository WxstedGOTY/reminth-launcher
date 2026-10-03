# Prompt 8 for the code-writing window: Home stat cards - no coloured edge, hover outline instead

Tiny visual change (CSS, maybe one class in renderer.js). Model: Sonnet 5.5, effort low. Send when the desktop window is idle.

---

```
Read CLAUDE.md and CLAUDE_CODE_HANDOFF_10.md sections 0-1. Pull main first. npm test, commit, push, update
DECISIONS_AND_TEST_PLAN.md as CLAUDE.md says. You can't run Electron: say what you could not test.
Touch only src/renderer/styles.css (CRLF stays CRLF, its last rule stays last) and, only if needed, the class
names in src/renderer/index.html / renderer.js for the Home stat row.

On the Home page the row of five stat cards (Mob kills, Player kills, Deaths, Blocks placed, Blocks broken;
ids statMobKills, statPlayerKills, statDeaths, statPlaced, statBroken; class .stat with the .s-violet / .s-amber /
.s-rose / .s-emerald / .s-cyan colour classes setting --sc) each have a thin COLOURED STRIP on their left edge.
 1. Remove that coloured left strip from those five cards (find where --sc draws it, probably a ::before or a
    border-left). Keep everything else: the numbers, labels, notes, the card size, and the soft tinted glow in
    the card's corner.
 2. Give those five cards the same HOVER OUTLINE the "Jump back in" world/server cards (.recent) have:
    on :hover the border colour becomes color-mix(in srgb, var(--accent) 28%, transparent) with the same
    transition (.16s border-color), and the same outline on keyboard focus-within if the card is focusable.
    No movement, no shadow, no scale - only the border colour, as on .recent. Do not change .recent itself.
 3. Make sure nothing else that shares the .s-* colour classes or the --sc variable changes (check the
    Player Statistics page, the streamer page and the bar lists with a search for ".s-" and "--sc"); if
    another place needs the strip, scope the removal to the Home stat row only.
 4. Keep the transitions under 200 ms and don't add shadows (project design rule).

When done: push and tell me (a) what you could not test, (b) every file you touched.
```
