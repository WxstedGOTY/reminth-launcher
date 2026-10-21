# Research for the owner to approve (21 Oct 2026)

Nothing here is built yet. Each part needs the owner's yes.

## 1. Which game versions to support (owner: "popular PvP versions only")

Found: there is no measured player-count data; articles agree on two tracks:
- **1.8.9** - classic PvP (most PvP servers/players focus on it, no attack cooldown). Many modern servers copy 1.8
  combat with plugins (PVPOneDotEight has builds for 1.20-1.21.11), so players can still join them from new versions.
- **1.21.x** - crystal PvP and the tier lists (MCTiers etc.); crystal setups are built for 1.21.11 and accept all
  1.21.x clients through ViaVersion.

**Recommendation:** keep 1.21.x + 26.x (already built), and ADD **1.8.9** - the one big PvP version we don't have.
Warning: 1.8.9 uses an old mod loader world (Forge 1.8.9 / Legacy Fabric); our HUD + home screen would need a separate,
mostly new build. Biggest single job in this list.

Sources: https://sportskeeda.com/minecraft/which-minecraft-version-best-pvp ,
https://www.esports.net/news/best-minecraft-version/ ,
https://builtbybit.com/resources/competitive-combat-update.71439/ ,
https://www.boxtoplay.com/en/minecraft-hosting/minecraft-server/modrinth-plugins/pvponedoteight-51908

## 2. Lag spikes

- **Ctrl+B = Narrator on/off: confirmed** (Minecraft feedback thread: players hit it by accident while holding Ctrl to
  sprint). Done: Spaceport now keeps the Narrator off and Ctrl+B disabled by default.
- **But:** no source links the Narrator to inventory LAG. The real inventory freeze (100-300 ms when a container opens)
  is a known issue; the mod **Smooth Container** (Modrinth) says it removes it. Candidate for our performance pack -
  check its licence, versions and that servers allow it before adding.
- Our own lag spike log (built today) will show what really causes spikes on real PCs.

Sources: https://feedback.minecraft.net/hc/en-us/community/posts/360056522191/comments/360014403471 ,
https://modrinth.com/project/Z9091xot , https://www.modpackindex.com/mod/160641/smooth-container

## 3. Hosting page (5 free + 5 paid, "ranked by performance")

**Honest problem:** no independent performance tests exist. Almost every "best host" list is written by a host or earns
money from its links (rankings even disagree: one puts Falix first, another Aternos). So we can't rank by measured lag.
**Recommendation:** rank by what each host publishes about its CPU (Minecraft runs mostly on ONE core, so single-core
speed matters most), show the CPU on each card with the date we checked, and say plainly "ranked by published hardware,
not measured". Or test them ourselves later (free ones are free to test).

Free hosts found (check limits on their own sites - free tiers change often):
- **Aternos** - unlimited slots, no renewing; queue to start, stops when empty; RAM not published.
- **Falix** - 4 GB free, says Ryzen 9 9950X3D (their own claim), FTP on free.
- **Minehut** - plugin servers, small, sleeps when empty, about 10 players max.
- **Minefort** - no card needed, click Renew every 2 days.
- **FreeMCHost** - renew every 48 hours.
Paid hosts mentioned (no benchmark covers Bisect or Pebble): Apex (Xeon/i9, from $4.49/2 GB), Shockbyte (budget,
average hardware), BisectHosting, PebbleHost, and smaller Ryzen 7950X/7950X3D hosts. Needs a second pass to pick 5.

Sources: https://www.itechguides.com/best/free-minecraft-server-hosting/ ,
https://wisehosting.com/blog/best-free-minecraft-server-hostings ,
https://cybernews.com/game-server-hosting/free-minecraft-hosting-services/ ,
https://falixnodes.net/falix-vs-aternos?lang=lt , https://pinggy.io/blog/best_minecraft_server_hosting/ ,
https://dathost.net/blog/minecraft-server-performance-benchmarks-2026 ,
https://mineguard.pro/en/blog/best-minecraft-server-hosting-2026

## 4. Second pass (21 Oct, later)

**Smooth Container (checked on Modrinth's own API):** licence **MIT** (fine to bundle), client-side required, Fabric/Forge/NeoForge,
last update 10 Jul 2026, only about 1,700 downloads. Versions: **1.20.1, 1.21.1, 1.21.11, 26.1.2 only** - no 26.2, 26.3 or
1.21.4-1.21.10, which are the versions our players use most. **Recommendation: do NOT add it now.** Too small and too few
versions; first let our own lag spike log show whether containers really cause spikes on real PCs.

**Paid hosts:** the only numbers found are the hosts' own (DatHost's table gives Apex ~18-20 TPS, Shockbyte 17-19, Bisect 17-19,
no method, and DatHost is itself a seller) - not usable as "performance". Nothing at all for PebbleHost. So the paid row cannot
honestly be ranked by measured performance. Options: (a) rank by published CPU, labelled "published hardware, not measured";
(b) buy the cheapest plan of a few hosts (a parent pays) and measure TPS ourselves. Owner picks later.
