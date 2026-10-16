# Spaceport Launcher: what's left for you (written 17 Oct 2026, night)

Everything in the code is renamed and tested (see `DECISIONS_AND_TEST_PLAN.md`, the newest section). These are the
things only you can click, because they are in your own accounts. Do them in this order. Each is a few minutes.
After each one, tell Claude "done <letter>".

## A. Rename the GitHub repo (2 minutes)
1. Open https://github.com/WxstedGOTY/reminth-launcher -> **Settings** (top right of the repo).
2. Under "Repository name" type `spaceport-launcher` -> **Rename**.
3. Nothing breaks: GitHub sends the old address to the new one, so players' updates keep working.

## B. Make the new website address in Cloudflare (10 minutes)
1. https://dash.cloudflare.com -> **Workers & Pages** -> **Create** -> **Pages** -> **Upload assets** (Direct Upload).
2. Project name: `spaceport-launcher` -> Create. Drag the `site` folder in once -> **Deploy**.
3. Open the new project -> **Settings** -> **Bindings** -> **Add** -> **D1 database**: name `DB`, database = **the same
   one** the `reminth` project uses (open the `reminth` project's Settings -> Bindings to see its name).
4. **Settings** -> **Variables and Secrets**: add the same names and values the `reminth` project has:
   `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_DISCORD_ID`,
   `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_PUBLIC_KEY` (and `TOKEN_KEY` if the `reminth` project has it).
   They must be **exactly the same**, otherwise saved Discord sign-ins can't be read.
5. Keep the `reminth` project. Every launcher before the rename still talks to reminth.pages.dev.

## C. Discord (5 minutes)
1. https://discord.com/developers/applications -> your app -> **General Information** -> Name: `Spaceport Launcher`
   -> Save. (This is the name people see when they sign in with Discord and the bot's name.)
2. **OAuth2** -> **Redirects** -> **Add Redirect**: `https://spaceport-launcher.pages.dev/api/auth/discord/callback`
   -> Save. (Keep the old reminth.pages.dev one too.)
3. Your Discord server's name: server menu -> Server Settings -> Overview -> Server Name, if you want it renamed.

## D. Google (5 minutes)
1. https://console.cloud.google.com -> **APIs & Services** -> **OAuth consent screen** -> App name: `Spaceport Launcher`.
2. **Credentials** -> your OAuth client -> **Authorized redirect URIs** -> add
   `https://spaceport-launcher.pages.dev/api/auth/google/callback` -> Save. (Keep the old one.)

## E. When you want to release (tell Claude "release")
Claude then: puts the renamed website live (the `spaceport-website` branch), switches the links to the new address
and repo name, sets the version (recommendation: **2.0.0**, a new name is a big step), builds the installer and gives
you the release text. Then you upload it on GitHub as always. After it's out: Discord owner tools -> **Set up my
server** and **Post the channel messages** (the bot renames its own rules and posts the new texts).

Not changed on purpose (say if you want them changed): the email `reminthsupport@gmail.com`, the X account
`x.com/reminthsupport`, and hidden names players never see (data folder `%APPDATA%\Reminth`, the program file
`Reminth.exe`, `reminth://` links, mod ids). Changing those would make players lose their data or break updates.
