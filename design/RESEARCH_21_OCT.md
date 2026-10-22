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

## 5. Owner chose option A (21 Oct 2026): rank hosts by the CPU each host publishes

Decision: order by published CPU, with a plain note on the page: "ordered by the processor each company says it uses -
not tested by us".
First check (one search each, NOT enough to publish): **Aternos does not publish a CPU** - staff said "Intel i7/Xeon" about 6
years ago, a later reply says it uses dozens of models now and can't name one. So a CPU ranking of the FREE row is only
possible for hosts that publish it (e.g. Falix claims Ryzen 9 9950X3D on its own page). For the paid row, official pages of
Bisect, Apex, Shockbyte, PebbleHost and Sparked were NOT found by search - each needs its own page read (WebFetch agent)
before anything is written on the site. Hosts that publish a CPU on their own pages: DedicatedMC (Ryzen 5 3600 / 9 3950X),
Winternode (Ryzen 7 3700X / 5800X), VeryCloud (Ryzen 7 7700X), xGaming (Ryzen 9 7950X), Torchbyte (Ryzen 9 5900X / 7950X3D).
**Rule for the page: a host with no published CPU is listed as "not published", never guessed, and goes last in its row.**
Sources: https://board.aternos.org/thread/40073-specs-of-the-aternos-servers/ , https://docs.dedicatedmc.io/general-information/server-specs ,
https://help.winternode.com/Getting-Started/Server-Hardware-Specifications , https://xgamingserver.com/minecraft-server-hosting ,
https://www.torchbyte.com/game/minecraft

## 6. Official pages read (21 Oct, owner's game was running - no test games, web reading only)

Published CPU per host, from the host's OWN pages (a search of each official site; not independently tested). Chips differ by
location on every host, so the page should say "best chip they list" and link the host's specs page.

PAID row (candidates, by the best chip each lists):
- **PebbleHost** - Premium: Ryzen 9 9900X (Europe), **Ryzen 9 9950X3D (North America)**, EPYC 4465P (Australia/Singapore/US West),
  7950X (Miami). Budget page still lists older chips (Ryzen 7 5700X, Intel) and is old. https://pebblehost.com/minecraft/premium , https://pebblehost.com/specs
- **Shockbyte** - up to **AMD EPYC 4465P, max 5.40 GHz** (EU notice says 4464P); Bedrock page: up to Ryzen 9 7950X, 5.70 GHz. https://shockbyte.com/hardware
- **Apex Hosting** - **Ryzen 9 7950X (4.5 GHz)** at most locations, 9 5900X on "EX" plans, but some locations still list old Xeon /
  i7-7700K (Sydney, Tel Aviv). https://apexminecrafthosting.com/server-specs/
- **BisectHosting** - "80% Ryzen" (own claim, FAQ says 65%+), newest buys Ryzen 7 9700X / 9900X, but Intel Xeon still in the mix;
  Minecraft Java is placed on high-frequency CPUs automatically; no per-plan chip named. https://www.bisecthosting.com/hardware-server-performance
- 5th paid host still to pick (Sparked Host? needs its own page read; DedicatedMC, Winternode, VeryCloud, xGaming, Torchbyte all
  publish chips - see section 5).

FREE row:
- **Falix** - free: 3 GB RAM (one page says 2.5), 1 CPU core, 10 GB, 1 server per account, sleeps when empty, 10-min idle kick.
  Its own pages did NOT name a chip in this search (the "Ryzen 9 9950X3D" claim came from a third-party article). https://falixnodes.net/free-minecraft-server-hosting
- **Aternos** - no chip published (see section 5).
- Minehut, Minefort, FreeMCHost, (exaroton free?) - not read yet.

Consequence for the page: for the free row almost nothing is published, so "ranked by CPU" will mostly say "not published". Better
for free hosts: show what IS published (RAM, slots, sleeps/renew rules) in a fixed order, and rank only by CPU in the paid row.
Owner to confirm.

## 7. Hosting list built as data (21 Oct, `src/renderer/hosts.js`, `test/hosts.test.js`)

- **Paid row (5), by best published chip:** PebbleHost (Ryzen 9 9950X3D), Sparked Host (9900X), BisectHosting (9900X, "mixed" so after Sparked),
  Shockbyte (EPYC 4465P, 5.4 GHz), Apex (7950X). The order of chips is a rule of thumb (`CHIP_SCORE`), not a benchmark; the owner can change it.
- **Free row: only 4 are verified**, ordered by RAM: Falix (3 GB), Minefort (1 GB), Minehut (1 GB), Aternos (not published).
  **exaroton is NOT free** (5-credit trial, then 1 credit per GB per hour) - left out. FreeMCHost not read yet, so not in the list.
  The 5th free host is still open; owner/next window: read FreeMCHost's own page, or pick another.
- Minehut: 1 GB, 10 players, sleeps when empty (own plans page). Minefort: 1 GB; its help centre says unlimited free use ended; renew rule not found.
- The page that SHOWS this (cards, "ordered by the processor each company says it uses - not tested by us", Add to my servers / Join) is not built:
  it is design work, waiting for Opus and the owner's Claude Design files. Re-read all pages before the first release (`CHECKED` in hosts.js).

## 8. Phase 0 result (22 Oct 2026): which hosts let a player control the server from another program?

Owner's decision: ONLY hosts with full control go on the "Select your host" page. Searches of each host's own docs (snippets, not every
page opened - read the cited page before building on it):

| Host | Control from another program? | Evidence |
|---|---|---|
| **BisectHosting** | **YES** - Pterodactyl client API with a key | Official docs https://www.bisecthosting.com/docs/server-spawn : key under Account > API Credentials (shown once), Bearer token, `POST /servers/{id}/power` (start/stop/restart/kill), `POST /servers/{id}/command`, `GET /servers/{id}/websocket` (live console), resources. Warns keys must never ship in a game client. |
| **Sparked Host** | **LIKELY YES** (old docs) | https://help.sparkedhost.com/en/article/how-to-use-the-pterodactyl-api-using-python-1qgp6n6/ : "API Credentials" in the panel, Bearer key, `/api/client/servers/<id>` and `/resources`, websocket. Articles ~3.5 years old and the panel was rebranded "Apollo" - re-check. |
| **exaroton** | **YES**, official API + token | https://www.npmjs.com/package/exaroton (console stream accepts commands). **Not free** (5-credit trial, then credits). |
| **PebbleHost** | **MAYBE** - its own signed API (HMAC), not the standard one | https://help.pebblehost.com/en/article/using-the-pebblehost-game-panel-api-mv0hk4/ : power actions (on/off/soft/cycle/reset); owner account only; one article is marked deprecated after a panel change. Needs the current docs read. |
| **Falix** | **UNKNOWN** | Console + power buttons in its panel; no API docs found. |
| **Apex Hosting** | **NO found** | Multicraft panel; no public API found. |
| **Shockbyte** | **NO found** | Multicraft panel; no API found. |
| **Aternos** | **NO** | No official API. |
| **Minehut** | **NO** | Its API is private/shut down (a wrapper says "private use only"). |
| **Minefort** | not found | - |

Result: **no FREE host with confirmed full control.** The "5 free + 5 paid" idea cannot be kept honestly; today: 2 confirmed paid
(Bisect, exaroton), 2 likely/maybe (Sparked, PebbleHost), 0 free. Free hosts stay possible later if one offers a client API
(Falix to be checked on its own panel; free Pterodactyl hosts such as HybridServers exist but are unverified).
