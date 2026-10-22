# Hosting plan: "Select your host" (22 Oct 2026) - PLAN ONLY, nothing built

**UPDATE 22 Oct (owner answers):** only hosts with FULL control go on the page; website login/see-your-servers: yes; name "Select your host": yes; Claude researches (done, see RESEARCH section 8: Bisect + exaroton confirmed, Sparked/PebbleHost likely/maybe, NO free host confirmed). The page is built in STEPS: 1 Select your host, 2 Settings (important first, then optional), 3 Add it in the launcher (IP address bar), more if needed (e.g. start it and wait until Online), then Done/check.

Owner's words (22 Oct): "select your host ... it all works on our page like the whitelisting, blacklisting, server name and
everything works on the launcher and our website. I don't know how I want it to look - I'll leave that on you. Don't start yet, just
plan; when you're ready I'll give you Opus 5.5." (Look: the owner left it to Claude this time. Earlier rule "don't design UI yourself"
stays for anything he hasn't delegated - see memory `dont-design-ui-myself`; this delegation is for THIS page only.)
Also from 21 Oct: the launcher button opens the website's host page; ordered by published chip (option A); 5 free + 5 paid.

## 1. What "everything works" needs (honest)

Controlling a server (start/stop, whitelist, ban list, name/MOTD, RAM use) from OUR launcher/website only works if the host lets
other programs control it. Researched 22 Oct (one search each, thin):
- **exaroton: has an official API** (Node/Java clients, token from the player's account page; start, stop, restart, console commands,
  so whitelist/ban commands work). BUT exaroton is not free (5-credit trial, then 1 credit per GB per hour).
- **Hosts on a Pterodactyl-style panel** usually let a player make a personal "client API key" that can start/stop, send console
  commands and edit files - **not confirmed for any of our 9 hosts yet.** Needs each host's own docs read first.
- **Aternos: no official API** (only unofficial tools - not allowed to build on). Falix, Minehut, Minefort: not checked.
So the real promise is: "full control for the hosts that have an API; for the rest, a link and the address box (Add to my servers / Join)".

## 2. The idea, in plain words

1. **Website page "Select your host"** (free row + paid row, ordered by published chip, honest note "not tested by us", no money from links).
   Each host: what it gives, its chip, a "Choose" button, and a badge **"Controls from Spaceport"** where the API exists.
2. **Launcher "Host a server" page = one button** that opens that website page, + the existing "Your server" address box
   (Add to my servers / Join). Once the player links a host, the same page shows their server(s) with name, online/offline, players,
   Start / Stop, Whitelist, Ban list, server name (MOTD), RAM - on the launcher and, later, on the website account page.
3. **Friends:** friends see which server you're on (ON by default, with a clear one-click Hide - owner's choice 21 Oct).

## 3. Phases (small, each tested, nothing released)

- **Phase 0 (research, Sonnet, ~1 h):** read each host's OWN docs for a player API (Falix, Minehut, Minefort, PebbleHost, Sparked,
  Bisect, Shockbyte, Apex, exaroton). Result: a table "API? what can it do? key or login?" in `design/RESEARCH_21_OCT.md`. Decides everything below.
- **Phase 1 (Opus): the website page** on the branch `spaceport-website` (the live site deploys from `main`, so it stays hidden until the first
  release) + the launcher button (link in ONE constant, the new address comes with the rename). Data is ready: `src/renderer/hosts.js`.
- **Phase 2 (Opus): link a host** in the launcher: the player pastes their API key (stored encrypted like the sign-in tokens, never sent to
  us). First host: whichever Phase 0 shows has the cleanest API. Then: server name, online/offline, players, start/stop.
- **Phase 3: whitelist / ban list / MOTD / RAM** through the API's console commands; "highest performance without asking" = the launcher
  picks the best server size the player's plan allows, nothing is bought for them.
- **Phase 4: friends see your server; public/private** (what the owner wants on the website too).

## 4. Rules for this

- No payments through Spaceport, no money from host links today (say it on the page; if a partnership comes, the note changes).
- API keys never leave the PC, never logged, encrypted at rest. A key can be removed with one click.
- Only official APIs - no scraping, no unofficial Aternos tools.
- Website pages only on the branch; no releases; GitHub history wipe still needs his explicit yes at the time.
- Facts about hosts are re-read before the first release (`CHECKED` in hosts.js).

## 5. Questions for the owner (when he starts Opus)

1. OK that "full control" only works for hosts that have an API, and the other hosts get "link + address + Join"?
2. Should the website page also let players log in and see their servers (needs the website account), or is the website only the "select a host" page?
3. Which host should be first for full control if exaroton (not free) is the only sure API - is that OK, or wait for Phase 0?
4. Name of the page/button: "Select your host" ok?
