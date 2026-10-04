# Reminth home screen (the game's title screen) - plan

Written 4 Oct 2026 by the desktop window, from the owner's description + checks against the real game files.
Status: PLAN. Nothing of it is built yet except the research below.

## 1. What the owner wants (his words, condensed)

- Like Lunar Client's title screen: aesthetic, **animated**, a **night** scene, a little **blurred**.
- Buttons: Singleplayer, Multiplayer (more later): **black**, nicely shaped, "exact Rubik's-cube tile but slightly
  rounded on the sides".
- **Bottom middle: a row of icons** (skin selector, mods, ...), easy to change in game, "and more stuff".
- The background is made on HIS PC: freecam / Iris shaders / a good night seed, found with commands.
- The Lunar-style in-game feature panel (mods, night vision, ...) is NOT part of this; later, on its own.

## 2. What the research found (checked, not guessed)

| Question | Answer |
|---|---|
| How does the game draw its rotating title background? | A 6-picture panorama: `assets/minecraft/textures/gui/title/background/panorama_0..5.png` (+ `panorama_overlay.png`). It rotates by itself = **the animation is free**. |
| Can a mod replace those pictures? | Yes: a Fabric mod's own `assets/minecraft/...` files override vanilla's (a resource pack of the player's still wins over the mod, which is correct). |
| Can the game photograph a panorama? | Yes, `Minecraft.grabPanoramixScreenshot(File)` (renders 6 faces into a folder). |
| Blur? | Bake a light blur into the 6 pictures (done with Java ImageIO; no extra tools). The game's own `menuBackgroundBlurriness` option also exists. |
| Shaders? | **Iris has a Fabric build for 26.1, 26.2, 26.3** (1.11.4 / 1.11.7). Complementary Reimagined r5.9.3, Complementary Unbound r5.9.3 and BSL 10.1.8 exist for 26.2. The owner's Sodium is 0.9.2 (Iris-compatible). |
| Title screen API (26.2)? | `TitleScreen extends Screen`; `init()`, `extractRenderState(GuiGraphicsExtractor,int,int,float)`, `extractBackground(...)`; 26.x names. Older games use `render(GuiGraphics,...)`. |
| Mod Menu on 26.2? | No release found under that slug today; the owner's instance has `modmenu-20.0.3`. The Mods button must work with it **if present** and be hidden otherwise. |
| Is there a skin selector in the game? | **No.** Skins can only be changed through the launcher/Mojang API. So the Skins icon opens the Reminth launcher's Skins page (a `reminth://skins` link, see section 6). |

## 3. How it is built

**One new mod, `reminthhome`** (own folder `home/`, same style as `hud/` and `hud-1.21/`; same Compat-family idea so
one source builds every Minecraft version later). Start with **26.2 (the owner's game), then 26.3, 26.1.x, then the
1.21.x families and 1.20.1** exactly like the HUD.

1. **Screen swap.** A small Mixin on `Minecraft.setScreen(Screen)`: when the screen is exactly the vanilla
   `TitleScreen` (not a subclass, not ours), use `ReminthTitleScreen` instead. Every way back to the title screen
   (leaving a world, a failed connection, startup) goes through that call, so it covers all of them.
   *Safety net:* if building our screen throws anything, log ONE line and open the vanilla title screen. The game
   must never fail to start because of this mod. `config/reminthhome.json` `{"enabled":true}` turns it off.
2. **Background.** The mod ships the 6 night panorama pictures (+ the overlay) so the vanilla panorama code shows
   them and rotates them. No custom 3D code = no extra risk, same cost as vanilla.
3. **Buttons.** Our own `Button` subclass that draws a near-black rounded tile (radius 5-6 px, 1 px faint light
   border, brighter on hover/focus, text light grey). Real `Button` widgets, so keyboard (Tab/Enter), controllers
   and the narrator keep working. Layout from the window size and GUI scale (1-4), never overlapping.
4. **Bottom icon row.** 5 icons (Skins, Mods, Options, Language, Quit), drawn from small PNG icons the mod ships,
   each a real button with a tooltip. Mods opens Mod Menu's screen if installed (looked up by name), else is hidden.
   Options/Language/Quit call the vanilla screens/actions. **Skins** opens `reminth://skins`.
5. **Quick-join.** Under Multiplayer: up to 2 server shortcuts read from the instance's own `servers.dat`
   (the last 2 played, else the first 2). Pressing one connects with the game's own `ConnectScreen`. Hidden when
   the list is empty.
6. **No invented content:** no splash text unless vanilla, no news, no ads. Version text bottom-left.

## 4. The background picture (the unattended night job)

Done with a **throwaway capture mod** (never shipped) on a **throwaway instance** with Iris + Sodium +
Complementary Reimagined (hash-checked downloads), driven the same way as the benchmark:
1. Create worlds with several seeds (the test mod can pass the seed), set time to night, clear weather.
2. Fly the camera (spectator, placed by the mod) to a handful of viewpoints per seed (spawn, high above, near
   water/mountains), wait for chunks and the shader, call `grabPanoramixScreenshot`.
3. **I look at the pictures myself** and pick the best 2 (shortlist), then show the owner.
4. Bake the blur + a gentle darkening at the bottom (for the buttons), check the 6 edges line up (a visible seam
   is a failure), shrink to 1024 px faces.
5. The owner makes the final choice. Pictures are ours (made on his PC); no stock images are used.

The owner said he has Freecam installed: not needed for this, the capture mod places the camera exactly.

## 5. Not-a-bug checklist (what I will test before it ships)

- Starts with the mod removed / disabled in config: vanilla screen. Starts with it: ours.
- Leave a world -> our screen again. Disconnect from a server -> ours (or the game's disconnect screen then ours).
- GUI scale 1, 2, 3, 4 and Auto at 854x480, 1280x720, 1920x1080 and a very wide window: nothing overlaps or is cut.
- Keyboard: Tab order, Enter, Esc does not close the title screen.
- With other mods that add title buttons (Mod Menu): the game does not crash; their buttons are simply not there.
- With the owner's resource packs (his panorama pack, if any) and with the 'Quick Play' launch argument (skips the title).
- Resize while open, fullscreen toggle, alt-tab.
- A broken `servers.dat` (empty, corrupt): no shortcuts, no crash.
- Memory/FPS: same as vanilla title screen (panorama is the game's own).
- Real-game screenshot of every claimed version before it is bundled (as with the HUD).

## 6. Launcher side (the other window, prompt 17)

- **Generalize "bundled mods"**: today only ReminthHUD is bundled/installed/tidied by name. Add a second mod
  (`reminthhome`) with its own per-instance switch (`homeScreen`, default ON for Fabric/Quilt) in the instance
  dialog next to the HUD switch. No jar exists yet -> the code and tests use fake jars.
- **`reminth://` links**: register the scheme (installer + `app.setAsDefaultProtocolClient`), handle it on first
  start and when Reminth is already running (`second-instance`), and ONLY allow-listed, side-effect-free targets
  (`reminth://skins`, `reminth://instance/<id>`, `reminth://home`). Anything else is ignored. A web page or a
  chat message could contain such a link, so it must never play, install, delete or send anything.
- Privacy text (the owner's name stays untouched): a sentence for the link handler is listed in the hand-off
  for the desktop window to add.

## 7. Order of work

| # | Who | What | Needs the PC quiet |
|---|---|---|---|
| 1 | cloud | Prompt 17 (launcher side) | no |
| 2 | desktop | Capture rig + seed scouting + pick shortlist | yes (hours) |
| 3 | desktop | `home/` mod for 26.2: swap, buttons, icon row, quick-join | tests: yes |
| 4 | owner | Chooses the picture + approves a real screenshot | no |
| 5 | desktop | 26.3 / 26.1.x, then 1.21.x families + 1.20.1 | yes |
| 6 | desktop | Bundle, release 1.4.7+, hand-off | no |

## 8. Decisions that are the owner's

1. Default ON for every Fabric/Quilt instance, or opt-in? (Recommend: ON, with the switch.)
2. The 5 icons: Skins, Mods, Options, Language, Quit. Add or swap? (Recommend: keep, nothing that needs a server.)
3. One picture or a few that rotate between launches? (Recommend: one first.)
4. Server shortcuts under Multiplayer: yes/no. (Recommend: yes, 2.)
