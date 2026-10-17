# Spaceport Launcher: what's left (updated 17 Oct 2026)

**The plan now (owner, 17 Oct):** no more GitHub releases for now. When the launcher is finished (he has hundreds of
changes in mind: UI, bugs, add-ons), the first Spaceport release is the first ever: GitHub starts from zero. The
website stays on Cloudflare at reminth.pages.dev until the move to Railway (paid hosting); no new Cloudflare project.
He continues on **Wednesday 22 Oct 2026** when his weekly limit resets.

## Nothing is broken right now
- `main` has the whole rename in code; nothing is released, installed or published. The live website still says
  Reminth (it changes only when the branch `spaceport-website` is merged into `main`).
- The branch `spaceport-website` holds the renamed website, bot, privacy v14 and terms v9. It's pushed and tested.
- The in-app privacy summary says version 14 while the live website says 13 until the first release: harmless.

## Small things you can do any time (each 2-5 minutes, optional, nothing depends on them)
1. **Discord app name** (https://discord.com/developers/applications -> your app -> General Information -> Name:
   `Spaceport Launcher` -> Save). This is the name people see when they sign in with Discord. Your Discord server's
   name: Server Settings -> Overview.
2. **Google app name** (https://console.cloud.google.com -> APIs & Services -> OAuth consent screen -> App name).
3. No Cloudflare changes. No GitHub rename yet (see below).

## Decide on Wednesday (Claude will ask first - these can't be undone)
- **Starting GitHub from zero.** Two ways, pick one:
  1. *Clean slate, same repo* (recommended): Claude makes a fresh history (one first commit with the current code),
     you delete the old releases (GitHub -> Releases -> each one -> Delete), and rename the repo to
     `spaceport-launcher`. Old Reminth installs (yours, your friend's) can't update after that: you'd reinstall.
  2. *A brand-new repo* `spaceport-launcher`: the old one stays or is deleted by you.
  Either way the old installed Reminth stops updating itself. If you have a 1.8.0 on your PC, you reinstall once.
- Version of the first release: 1.0.0 (a fresh start) - Claude recommends it over 2.0.0 now.
- The updater and website still point at the old repo name until then (`package.json` `publish`, `updater.js`,
  the download links on the website branch) - Claude switches them all together with the rename.
- Moving to Railway later: Claude will plan it with you (the site's `functions/` run on Cloudflare Workers; Railway
  runs normal servers, so some code changes).

## Not changed on purpose
The email `reminthsupport@gmail.com`, the X account `x.com/reminthsupport`, and hidden names players never see (data
folder `%APPDATA%\Reminth`, program file `Reminth.exe`, `reminth://` links, mod ids) - changing them would make players
lose data or break updates. With a fresh start (nobody has the old one) Claude can also clean these on Wednesday if you
want: just say so.
