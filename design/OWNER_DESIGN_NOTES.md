# The owner's UI instructions (running list, category 1: the launcher app) - newest at the bottom

Rule: do NOT design on my own (memory `dont-design-ui-myself`); apply what he says, exactly. Items marked WAITING are for
something he has not sent yet.

## 22 Oct 2026

1. **WAITING - the new Spaceport launch game box (being made in Claude Design, he will send it).**
   Hover animation: **50% slower, same depth.** Today (`src/renderer/motion.css` lines 49-51): `.nh-panel-art { transition: transform .5s var(--m-ease), filter .5s ease; }`
   and `.nh-panel:hover .nh-panel-art { transform: scale(1.09); filter: brightness(1.06); }`. So: keep **scale 1.09** (the depth, the distance it moves)
   and make the time **half the speed = 1.0 s** (.5 s -> 1 s) on the new box. If he meant "50% longer" (0.75 s) he will say so - ask once when the box arrives.
   Note: CLAUDE.md of the restaurant project says transitions under 200 ms - that is a different project, not this one.
