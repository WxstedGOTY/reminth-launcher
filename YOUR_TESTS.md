# What only you can test (about 35 minutes, plus a friend later)

Everything else is already tested. Do these in this order, then publish `release-1.4.8\` as v1.4.8.

## 0. (changed) The earlier test window is closed
I closed it while fixing a title-screen bug you found (Back from Create World showed the normal screen) - it is fixed in the new installer. Your own game is not touched.

## 0b. Was open for you
A Minecraft 26.2 window is open on the new **Reminth title screen** (aurora picture, dark rounded buttons, icon row at the bottom).
It is a test copy with a fake player, so it can't join real servers. Look at it, click around (Options, Language), then close it.

## 1. Install the new launcher - 5 min
Run `release-1.4.8\Reminth-Setup.exe`. Reminth opens by itself. Expected: it keeps your account and instances.
Then open Settings: **Hardware acceleration** should say "Keep this on" (turn it OFF only to see the warning popup, then press Cancel).

## 2. Library and streamer mode - 3 min
- Click **Library** (left bar): it shows clips and screenshots now, with the blue line "Are you a content creator? Check out streamer mode".
- Click the blue words: the Streamer settings page opens, with an on/off switch at the top.

## 3. The home screen in your own game - 5 min
Your instance has no home screen yet - it arrives when you install step 1 and press **Play** once. Then on your Reminth instance (26.2):
- the title screen is the aurora one, buttons look right;
- click Singleplayer (with no worlds it opens Create World - press Cancel), Options, Language: each opens and **Back/Esc returns to the aurora screen** (this was the bug);
- the icon row now has a **cloud icon = Minecraft Realms**;
- click the **person icon (Skins)**: Reminth comes to the front on its Skins page;
- open a world and "Save and Quit to Title": the aurora screen is back.
Then on **26.3** (any instance): click Singleplayer and Multiplayer once (my scripted clicks misfired there).

## 4. Server statistics - 12 min  (this is the one I could not test)
- Play on your crystal PvP server for about 5 minutes. Break some blocks.
- Wait 2 more minutes (it updates about every 90 seconds). Quit the game.
- In Reminth open **Player Statistics** and press Refresh. Expected: it says "Across ... worlds and 1 server" and **Blocks mined** went up.
- If it did not: tell me the server's name. Some servers keep no normal Minecraft stats and cannot be counted.

## 5. A quick look at lag - 3 min
Scroll Home and switch tabs: should be smooth with hardware acceleration on.

## 6. Later
- A friend with an **AMD or Intel graphics card** installs the same installer and starts any version: tells you if anything is black or crashes.
- Publish: GitHub -> Releases -> new release v1.4.8 -> upload the 3 files in `release-1.4.8\` -> paste the description.

Not covered anywhere: playing more than an hour, joining servers that need a login (my test account is offline).
