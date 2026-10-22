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

7. **DONE 22 Oct (evening) - LAUNCH GAME text like Lunar's** (owner took a screenshot of Lunar's Home, `Pictures\Screenshots\Screenshot (23).png`, and said "use that because I like it"):
   Lunar's button text is a very heavy, tight geometric sans. I can't use Lunar's own font files, so the title and the "Launch Spaceport" line now use **Plus Jakarta Sans** (SIL OFL, `assets/fonts/PlusJakartaSans.ttf` variable 200-800 + `OFL-PlusJakartaSans.txt`): title weight 800, letter-spacing -.01em, word-spacing .12em; sub line weight 600. The Chakra Petch files were removed (unused). Progress text with numbers still Inter.
   NOTE for later: he said earlier the launcher "looks like a copy paste of Lunar" - matching Lunar's text style goes the other way; he chose it, but remember it when he reviews the whole look.

8. **DONE 22 Oct (evening) - LAUNCH GAME text, second pass** (owner: "text smaller like Lunar's and less space inside the letters, almost no background showing"):
   Title size 2.4cqw -> **1.95cqw** (15-26 px) - measured: the text is now ~51% of the button's width, the same as in his Lunar screenshot (before 63%); letter-spacing -.01em -> **-.03em**; a thin text stroke (`-webkit-text-stroke: .035em`) thickens the letters so the holes stay tiny; the sub line 1.1cqw -> .95cqw. The progress state (Inter, numbers) has no stroke.

9. **DONE 22 Oct (evening) - LAUNCH GAME: text closer to the triangle** (gap between the play triangle and the text 12 px -> `clamp(4px, .4cqw, 6px)`, styles.css `.nh-play-title`). The triangle and text stay centred together as one group.

10. **DONE 22 Oct (evening) - LAUNCH GAME: the TEXT in the exact middle** (owner: "get the triangle and text more to the left, I want the text right in the middle"): the text "LAUNCH GAME" is centred in the button (same centre as "Launch Spaceport"), the triangle hangs on its left; done with an empty balancing block on the right as wide as triangle + gap (`.nh-play-title:has(> .i)::after`, styles.css). Measured in a 4x crop: text centre within ~1 px of the button centre.

11. **DONE 22 Oct (evening) - LAUNCH GAME: our icon under the title, text slightly right** (owner: "text and the triangle slightly to the right, really slightly, and the text below also slightly to the right, so you can put our icon, just smaller, on the left of the text below"):
   Our mark (the Moonrise cube, `assets/icons/source/reminth-mark-night.svg`) sits on the left of "Launch Spaceport", `clamp(11px, 1.05cqw, 15px)`; the title (triangle + text) and the line under it are nudged right by half of icon + gap (about 6-7 px) so the two TEXTS stay lined up with each other. New markup `.nh-play-subrow` (index.html) wraps the icon and the sub text; `.no-sub` hides the row; while launching/playing the title has no nudge. Seen in the hidden copy (normal and launching states).

12. **BUG FIXED 22 Oct (evening) - the skin waved BEHIND the character** (owner: "when it waves, it waves behind, not toward the user"):
   Cause: `skinview.js` is a CSS-3D viewer; in CSS a negative `rotateX` swings a hanging arm AWAY from the viewer. The hello wave used -165 deg (hand up and behind the back) and the small hand "fidgets" -34 deg (also backwards, though the comment said forward). Now **+165** for the wave and **+34** for the fidgets: the hand goes up and FORWARD, toward the user. The sideways (Z) swing and the position next to the head are unchanged (the hand still stays clear of the rail). Checked in the hidden copy by posing the wave by hand (hidden windows don't animate): from the front and from the side (yaw 75) - before: hand raised behind the back, after: raised in front. Also used on the Skins page viewer (same file): its wave is the same code.

13. **DONE 22 Oct (evening) - no "Preparing…" box; "Joining…" / "Launching…"** (owner's screenshot `Screenshot (24).png`: after a failed launch ("Not signed in") a box "Preparing…" with an empty bar and a x showed under Home's launch area; "remove it completely, when someone presses Launch game or Join it says Joining or Launching game"):
   - Cause: `appendLog` (an error line) unhid the progress box with its HTML default text "Preparing…". Now the box only appears when a REAL progress stage has arrived (`state.progress`); a launch that fails before that shows just the red line, which goes away by itself after 10 s (there is no x without the box; the error toast stays). The default text "Preparing…" is removed from both bars in index.html (they get a real stage text at the first event). Left alone: the modpack-install dialog in features.js has its own label "Preparing…" inside a hidden progress strip (it is replaced by the first real stage) - say so if he wants that word gone too.
   - Text: new `state.joining` (instance -> {host, port}) is set while a run was started by JOIN (server cards, sponsor box, any `runPlay` with `join`). The big button says **"Joining…"** instead of "Launching…" and the JOIN that was pressed says "Joining…" (others stay JOIN, greyed). Launch game still says "Launching…".
   Seen in the hidden copy (simulated: an error with no progress; a join in flight). Not seen with a real failed launch or a real join.

14. **FIXED 22 Oct (night) - Discover stopped at 500 pages** (owner: "why can we only see 500 pages? we should be able to go to the max"):
   Cause: the launcher's own cap, not Modrinth's - `features.js runBrowse` did `disc.total = Math.min(total, 10000)` (10,000 results / 20 per page = 500 pages), and the default view reads a saved catalog of only the top 10,000 per type (`main.js CACHE_WARM_TARGET`). Modrinth really has ~77,500 mods and answers pages as deep as 100,000 results (tested: offset 50,000 returns hits).
   Now: `MAX_DISCOVER_RESULTS = 100000`; the default view asks Modrinth once per kind for its real total (`realTotalFor`) and pages past the saved catalog already used the live API (now sorted by downloads like the saved list); servers lost the same cap. Seen: all mods with "Works with" off -> 3,877 pages, page 3000 shows real mods, the last page 3,877 shows the last mod and Next turns off. With "Works with Spaceport" ON the count is smaller on purpose (only mods that fit the instance: 663 pages for Fabric 26.2).
   Not done: the pager has no "jump to page" box (1 ... 2999 3000 3001 ... 3877, plus first/last/next) - offer it if he wants to type a page number.
