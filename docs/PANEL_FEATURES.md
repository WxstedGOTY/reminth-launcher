# Reminth panel: feature list (draft for the owner's OK)

Researched 7 Oct 2026 from what Lunar Client (its 71 built-in mods), Badlion Client (100+ mods: Armor/Potion Status,
Toggle Sneak, Time Changer, Crosshair, CPS/FPS/Ping...), Feather (HUDs, smooth zoom, freelook, fullbright) and popular
Fabric mods (AppleSkin, Status Effect Bars, uku's Armor HUD, BetterF3, Shulker Box Tooltip, Chat Heads, BetterHurtCam,
Low Fire, Clean Keystrokes, TotemCounter...) offer. Everything here is written from scratch inside our own bundled mod -
no code, textures, icons or fonts from those clients.

**Server-rule risk** (from the rules found on 7 Oct for DonutSMP, Hypixel, MCC Island, MCPVP, and what those clients ship
on such servers):
- **Safe** - only shows your own information or changes how things look; allowed almost everywhere.
- **Check** - fine on most servers, some ban it (named where known). Reminth's ban warning will list it per server.
- **Many ban** - OFF by default, labelled "many servers ban this" in the panel.

**Difficulty**: easy (a HUD line or a setting), medium (new drawing or several hooks), hard (new systems, or different
code on every Minecraft version).

## HUD (on-screen displays - all movable and resizable in "Edit HUD layout")

| # | Name | What it does | Difficulty | Risk |
|---|---|---|---|---|
| 1 | FPS | Frames per second, optional min/avg | easy | Safe |
| 2 | Ping | Your ping to the server, coloured green/yellow/red | easy | Safe |
| 3 | CPS | Your clicks per second, left and right | easy | Safe |
| 4 | Keystrokes | W A S D, space, mouse buttons lighting up as you press them | easy | Safe |
| 5 | Coordinates | X Y Z, optional facing direction and nether/overworld conversion | easy | Safe |
| 6 | Direction HUD | A compass strip at the top of the screen | medium | Safe |
| 7 | Biome | The biome you are in | easy | Safe |
| 8 | Day counter | Days passed in the world | easy | Safe |
| 9 | Real clock | Your computer's time, 12/24 h | easy | Safe |
| 10 | World clock | The in-game time of day | easy | Safe |
| 11 | Armor status | Your armor pieces and their durability, left of the hotbar | medium | Safe |
| 12 | Held item durability | Durability of the item in your hands, left of the hotbar | easy | Safe |
| 13 | Potion effects | Each effect with its exact level (II, IV...) and seconds left, blinking when ending | medium | Safe |
| 14 | Health numbers | Your health as a number next to the hearts (also absorption) | easy | Safe |
| 15 | Food and saturation | Hunger and saturation numbers, saturation shown on the hunger bar | medium | Safe |
| 16 | Armor numbers | Armor and toughness points as numbers | easy | Safe |
| 17 | Memory usage | How much RAM the game uses | easy | Safe |
| 18 | Server address | The server you are on | easy | Safe |
| 19 | Session time | How long you have played this session | easy | Safe |
| 20 | Stopwatch | Start/stop/reset with a key | easy | Safe |
| 21 | Speed | Your speed in blocks per second | easy | Safe |
| 22 | Light level | Light level of the block you stand on | easy | Safe |
| 23 | Totem counter | How many totems you carry | easy | Safe |
| 24 | Item counter | Count of chosen items you carry (arrows, pearls, gapples, blocks...) | medium | Safe |
| 25 | Pack display | The resource packs you have on | easy | Safe |
| 26 | Boss bar options | Move, scale or hide the boss bar | medium | Safe |
| 27 | Scoreboard options | Move, scale, hide the red numbers, background | medium | Safe |
| 28 | Tab list options | Ping as numbers, player heads, scale | medium | Safe |
| 29 | Combo counter | Hits you landed in a row | medium | Safe |
| 30 | Reach display | Distance of your last hit | medium | Check (some PvP servers) |
| 31 | Elytra HUD | Angle and speed while flying with an elytra | medium | Safe |
| 32 | Low durability warning | Flashes when armor or the held tool is almost broken | easy | Safe |
| 33 | Inventory full | Shows when your inventory is full | easy | Safe |
| 34 | Hotbar customizer | Move the hotbar, or make it vertical | hard | Safe |
| 35 | Cooldowns | Ender pearl, shield, chorus cooldowns as timers | medium | Safe |
| 36 | Locator bar options | Move or restyle the player locator bar (1.21.6+) | hard | Safe |
| 37 | Server lag (TPS) | Estimated server speed from the time it sends | medium | Safe |
| 38 | Death point | Where you last died, as coordinates | easy | Safe |
| 39 | PvP info | Hits given and taken this fight | medium | Safe |
| 40 | Custom text | Your own label anywhere on screen | easy | Safe |

## Visual (how the game looks)

| # | Name | What it does | Difficulty | Risk |
|---|---|---|---|---|
| 41 | Zoom | Hold a key to zoom, scroll to zoom more, smooth | medium | Safe |
| 42 | Crosshair | Your own crosshair shape, size, colour, gap | medium | Safe |
| 43 | Hit color | Colour of the red flash on hit mobs and players | medium | Safe |
| 44 | Hurt cam | Less or no screen shake when hit | easy | Safe |
| 45 | Low fire | Lowers the fire overlay on your screen | easy | Safe |
| 46 | Held item size | Size and position of items in your hands (small sword, small totem, low shield) | medium | Safe |
| 47 | Particle multiplier | More or fewer crit and hit particles | medium | Safe |
| 48 | Particle hider | Hide explosion, block-break, rain or potion particles | medium | Safe |
| 49 | Weather changer | Clear, rain or snow - only on your screen | easy | Safe |
| 50 | Time changer | Day or night - only on your screen | easy | Safe |
| 51 | Fullbright | Everything fully lit | easy | **Many ban** (OFF) |
| 52 | Night vision (visual) | Night-vision look without the effect | easy | **Many ban** (OFF) |
| 53 | Fog options | Less fog over land, water and lava | medium | Check (can show more than others see) |
| 54 | FOV options | Turn off speed/sprint FOV changes, custom FOV | easy | Safe |
| 55 | Motion blur | Blur when turning | hard | Safe |
| 56 | Menu blur | Blur the world behind menus | medium | Safe |
| 57 | Block outline | Colour and thickness of the block outline | medium | Safe |
| 58 | Glint colour | Colour of the enchantment shine | medium | Safe |
| 59 | 2D items | Dropped items drawn flat | medium | Safe |
| 60 | Item physics | Dropped items lie on the ground | hard | Safe |
| 61 | Nametags | Your own nametag in F5, background, shadow, scale | medium | Safe |
| 62 | Shiny potions | Potions glint like enchanted items | easy | Safe |
| 63 | Old animations | 1.7-style sword and bow animations | hard | Safe |
| 64 | Totem pop size | Size and length of the totem pop on screen | medium | Safe |
| 65 | Overlay options | Smaller pumpkin, portal and vignette overlays | medium | Check (pumpkin overlay on some PvP servers) |
| 66 | Chunk borders | Show chunk borders (the game's own F3+G, with colours) | easy | Safe |
| 67 | Clouds | Cloud height, style, off | easy | Safe |
| 68 | Hitboxes | Show hitboxes (the game's own F3+B, with colours) | easy | Check (some PvP servers) |
| 69 | Colour saturation | More or less colourful world | medium | Safe |
| 70 | Container animations | Chests and inventories open with a short animation | medium | Safe |
| 71 | Own armor | Hide or fade your own armor in F5 | medium | Safe |
| 72 | Dynamic crosshair | Crosshair turns red when aiming at a player or mob in reach | medium | Check (some PvP servers) |

## Mechanic (how controls behave - nothing plays for you)

| # | Name | What it does | Difficulty | Risk |
|---|---|---|---|---|
| 73 | Toggle sprint | Press once to keep sprinting | easy | Safe |
| 74 | Toggle sneak | Press once to keep sneaking | easy | Safe |
| 75 | Freelook | Look around without turning your player | medium | Check (MCC Island bans it) |
| 76 | Snaplook | Hold a key for a quick look behind you | easy | Safe |
| 77 | Waypoints | Your own marked places, shown as a beam and distance (no radar) | hard | Check (Hypixel, MCC Island) |
| 78 | Scrollable tooltips | Scroll long item tooltips | medium | Safe |
| 79 | Shulker box preview | See a shulker box's contents in its tooltip | medium | Safe |
| 80 | Map preview | See a map in its tooltip | medium | Safe |
| 81 | Tooltip extras | Durability numbers and food values in tooltips | easy | Safe |
| 82 | Drop protection | Asks before you drop or throw an enchanted or named item | easy | Safe |
| 83 | Screenshot helper | Copy the last screenshot, open the folder | easy | Safe |
| 84 | Pack organizer | Folders and search in the resource pack screen | hard | Safe |
| 85 | Key conflicts | Shows keys bound twice, search in Controls | medium | Safe |
| 86 | Sensitivity profiles | Switch mouse sensitivity with a key | easy | Safe |

## Chat

| # | Name | What it does | Difficulty | Risk |
|---|---|---|---|---|
| 87 | Timestamps | Time in front of each message | easy | Safe |
| 88 | Chat heads | The sender's head next to messages | medium | Safe |
| 89 | Compact chat | Repeated messages stack as "x3" | medium | Safe |
| 90 | Longer history | Keep more chat lines | easy | Safe |
| 91 | Chat search | Search what was said | medium | Safe |
| 92 | Copy message | Click a message to copy it | medium | Safe |
| 93 | Highlight words | Your name or chosen words in colour, with a sound | medium | Safe |
| 94 | Chat look | Background opacity, width, height, scale | easy | Safe |
| 95 | Nick hider | Hides your name on your own screen (for streaming) | medium | Safe |

## Utility

| # | Name | What it does | Difficulty | Risk |
|---|---|---|---|---|
| 96 | Profiles per server | The panel switches to a profile when you join a chosen server | medium | Safe |
| 97 | Server rules guard | Reminth's own warning before joining a server that bans a mod you have on (already built) | done | Safe |
| 98 | TNT countdown | Seconds left above lit TNT | medium | Safe |
| 99 | Replay recording | Record and watch back your gameplay | hard | Safe |
| 100 | Quick server list | Your favourite servers one click away from the panel | medium | Safe |
| 101 | Session stats | Kills, deaths, blocks broken this session | medium | Safe |

## Left out on purpose (automate play or give an unfair edge)

Auto-clicker, macros and chat hot-keys that send messages for you, X-ray (also X-ray packs), hitbox or reach changers,
radar/ESP, entity minimap, auto totem, auto armor, auto refill or sorting (Inventory Profiles Next-style), mouse
tweaks/item scrollers, crystal and anchor optimizers (MCPVP bans them; "Impossible Actions" bans), freecam on servers,
inventory walk, health bars over other players.

## First batch for 26.2 (step 2) - the 10-15 easiest and safest

FPS (1), Ping (2), CPS (3), Keystrokes (4), Coordinates (5), Real clock (9), Armor status (11), Held item durability
(12), Potion effects (13), Totem counter (23), Hurt cam (44), Low fire (45), Toggle sprint (73), Toggle sneak (74),
Zoom (41).
