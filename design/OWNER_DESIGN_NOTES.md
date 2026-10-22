# The owner's UI instructions (running list, category 1: the launcher app) - newest at the bottom

Rule: do NOT design on my own (memory `dont-design-ui-myself`); apply what he says, exactly. Items marked WAITING are for
something he has not sent yet.

## 22 Oct 2026

1. **DONE 22 Oct (evening) - the new Spaceport launch game box** (`launch game panel/reminth-launch-banner.png`, 2560x640, from Claude Design). Used as `assets/img/launch-panel.webp`: cropped inside its own border (2500x580, panel `aspect-ratio: 2500 / 580`), the painted LAUNCH GAME button and the 6-icon row painted out with plain starfield (script idea: per-row blend + a few stars). The REAL button (cream, "Launch Spaceport" under it) is sized like the painted one (`clamp(230px, 24cqw, 420px)` wide, text 2.1cqw, tight letter-spacing) and the real recent tiles hang under it in the dark row as before. Owner chose this ("real button + real tiles on top of the picture"). The 6 painted icons (sword, shield, flag, cube, mountains, tree) were NOT used - ask what they were meant for if he mentions them. Hover: done as below.
   Original note:
   Hover animation: **50% slower, same depth.** Today (`src/renderer/motion.css` lines 49-51): `.nh-panel-art { transition: transform .5s var(--m-ease), filter .5s ease; }`
   and `.nh-panel:hover .nh-panel-art { transform: scale(1.09); filter: brightness(1.06); }`. So: keep **scale 1.09** (the depth, the distance it moves)
   and make the time **half the speed = 1.0 s** (APPLIED in motion.css; scale 1.09 kept) (.5 s -> 1 s) on the new box. If he meant "50% longer" (0.75 s) he will say so - ask once when the box arrives.
   Note: CLAUDE.md of the restaurant project says transitions under 200 ms - that is a different project, not this one.
