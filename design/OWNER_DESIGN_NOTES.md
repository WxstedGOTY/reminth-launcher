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

2. **DONE 22 Oct (evening) - all server cards on Home: hover 50% slower, same depth** (owner: "do the 50% slower thing on also all the servers").
   Picture zoom `.nh-srv-pic img` .45 s -> .9 s (scale 1.06 kept; motion.css); card border brighten .18 s -> .36 s (styles.css). The entry animation
   when Home opens (.32 s) was not touched (it is not a hover). Also applies to the sponsor/contact box if shown (same classes).

3. **DONE 22 Oct (evening) - hover timing adjusted again** (owner: "25% longer for the launch game and 10 percent longer for servers"), read as ON TOP of the current times:
   launch game box 1 s -> **1.25 s**; server card picture .9 s -> **.99 s** and its border .36 s -> **.4 s**. Depth unchanged (1.09 / 1.06).
   Totals vs the ORIGINAL: launch box .5 s -> 1.25 s (2.5x), servers .45 s -> .99 s (2.2x). If he meant 25%/10% longer than the ORIGINAL, say so and revert to .625 s / .5 s.

4. **DONE 22 Oct (evening) - LAUNCH GAME button** (owner: "15% bigger in slow time and slightly glow, really slightly; I don't like the font, it's boring, make it better the way you think"):
   Hover: grows **15%** (`transform: scale(1.15)`, was a 2 px lift) over **1.25 s** (same slow time as the box behind it), glow only very slightly up (shadow .16 -> .21, 54 px; styles.css). Pressed: 1.1.
   Font (my choice, he delegated it): the title is now **Pixelify Sans, weight 500** (the app's heading font; 600+ closes the C), uppercase, letter-spacing .06em, size 2.5cqw (19-34 px). "Launch Spaceport" under it stays Inter. While it installs/launches ("progressing" state: percent numbers, "Playing") the title goes back to Inter because Pixelify misreads digits 2/5/7 (his own rule).
   Seen in the hidden copy at 1500 wide (normal, hover size, and a 2.2x zoom to check the C). Not seen: the progressing state with the new button size.

5. **DONE 22 Oct (evening) - LAUNCH GAME button, second round** (owner: "it gets WAY too big, make it smaller and slightly slower, I don't like the blocky font either"):
   Hover grow **15% -> 6%** (`scale(1.06)`, pressed 1.03); time **1.25 s -> 1.6 s**. Font: Pixelify (too blocky) replaced by **Chakra Petch SemiBold** (SIL OFL, `assets/fonts/ChakraPetch-SemiBold.ttf` + `OFL-ChakraPetch.txt`, @font-face in styles.css), uppercase, letter-spacing .05em, 2.4cqw. Progress text with numbers still Inter. My pick again (he delegated); candidates if he dislikes it: Rajdhani, Orbitron, Oxanium, Exo 2, Space Grotesk. Seen in the hidden copy.

6. **DONE 22 Oct (evening) - LAUNCH GAME, third round** (owner: "more bold, letters closer to each other but a slight space, and the whole launch game box slower on the animation"):
   Font **Chakra Petch Bold 700** (`assets/fonts/ChakraPetch-Bold.ttf`, OFL), letter-spacing **.05em -> .015em**. Hover times: box picture **1.25 s -> 1.6 s** (scale 1.09 kept), button **1.6 s -> 2.0 s** (scale 1.06 kept). "The whole thing" read as picture + button; the box's fade-in when Home opens (.34 s / .55 s) was NOT slowed - say so if he meant that too.
