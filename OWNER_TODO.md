# Your steps - one small thing at a time

**Where you are (10 Oct 2026):** 1.7.1 is published (checked). Accounts (Discord + email) are live.
**Next: Part E - the bot builds your Discord server for you** (about 15 minutes of clicking, then one button).

Do one step, then the next. If a screen looks different, stop and tell me what you see.
**Never send the Bot Token to anyone, not even me.** It goes only into Cloudflare.

---

## Part E - The Reminth bot builds your server

**E0. Make an empty server** (30 seconds)
1. In Discord, click the **+** at the bottom of your server list (Add a Server).
2. **Create My Own** -> **For me and my friends** -> name it `Reminth` -> **Create**.
   (Don't make channels or roles - the bot does that. Leave the picture - the bot sets the Reminth icon.)

You'll now put 4 things into Cloudflare. Open Notepad to keep them while you work.

**E1. Public Key**
1. Open https://discord.com/developers/applications and click **Reminth**.
2. You're on **General Information**. Under **Public Key**, click **Copy**. Paste it into Notepad.

**E2. Bot Token**
1. Left menu: **Bot**.
2. Click **Reset Token**, then **Yes, do it!**, then **Copy**. Paste it into Notepad.
3. Turn **Public Bot** OFF, then **Save Changes**.
   If it says "Private application cannot have a default authorization link": left menu **Installation** ->
   **Install Link** -> **None** -> **Save Changes**, then go back to **Bot** and turn Public Bot OFF.

**E3. Your own Discord ID**
1. In the Discord app: **User Settings** (the cog) -> **Advanced** -> turn **Developer Mode** ON.
2. Close settings. Click your own name/picture at the bottom left -> **Copy User ID**. Paste it into Notepad.

**E4. Your server's ID**
1. Right-click your new **Reminth server icon** on the left -> **Copy Server ID**. Paste it into Notepad.

**E5. Put all 4 into Cloudflare**
1. https://dash.cloudflare.com -> **Workers & Pages** -> **reminth** -> **Settings** -> **Variables and Secrets** -> **Add**.
2. Add these 4 (Production):

| Variable name        | Type   | Value                 |
|----------------------|--------|-----------------------|
| `DISCORD_PUBLIC_KEY` | Text   | the Public Key (E1)   |
| `DISCORD_BOT_TOKEN`  | Secret | the Bot Token (E2)    |
| `ADMIN_DISCORD_ID`   | Text   | your own ID (E3)      |
| `DISCORD_GUILD_ID`   | Text   | the server ID (E4)    |

3. Click **Save**.

**E6. Restart the website**
GitHub -> **Actions** -> **Website to Cloudflare** -> **Run workflow** -> green **Run workflow**. Wait for the green tick.

**E7. Tell Discord where the bot lives**
1. Back in the developer portal -> **Reminth** -> **General Information**.
2. **Interactions Endpoint URL** - paste exactly:
   `https://reminth.pages.dev/api/discord/interactions`
3. Click **Save Changes**. (Discord tests the address right away. If it says it couldn't verify it, E6 isn't
   finished yet - wait a minute and save again.)

**E8. Add the bot to your server**
1. Left menu: **OAuth2** -> **OAuth2 URL Generator**.
2. Under **Scopes**, tick: **bot** and **applications.commands**.
3. Under **Bot Permissions**, tick only: **Administrator** (it needs to make channels, roles and webhooks).
4. Copy the **Generated URL** at the bottom, open it in your browser, pick your **Reminth** server -> **Authorize**.

**E9. Press the button**
1. Open https://reminth.pages.dev/account (signed in with your Discord).
2. In **Owner tools**, click **Build my Discord server** -> **OK**. Watch the list - it takes about a minute
   (Discord makes it wait a few seconds now and then, that's normal).
3. When it says **Done**, look at your server: categories, channels, roles, welcome + rules, the Reminth icon.

**E10. Put the bot's role at the top**
In Discord: **Server Settings** -> **Roles** -> drag the **Reminth** role (the bot's) to the very top.
The bot can only moderate people whose roles are below its own.

**E11. Release posts in #updates**
1. Back on the account page, under the build list, click **Copy the webhook address**.
2. GitHub -> your repo -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**:
   - Name: `DISCORD_UPDATES_WEBHOOK`
   - Secret: paste -> **Add secret**
3. Test it: GitHub -> **Actions** -> **Announce release on Discord** -> **Run workflow** -> tag `1.7.1` -> green
   **Run workflow**. "Reminth 1.7.1 is out" should appear in #updates.

**E12. Try it** - in your server type `/download`, `/help`, `/verify`. Then tell me **"Part E done"** and what you see.

---

## What the bot builds

- **Roles:** Moderator (orange, can kick/ban/timeout/delete messages), Reminth Player (cyan, for people with a Reminth account - `/verify`)
- **📌 Start here:** #welcome, #rules, #announcements, #updates (only mods and the bot can write)
- **💬 Community:** #general, #pvp-talk, #clips-and-screenshots, #off-topic
- **🛠️ Help:** #help, #bug-reports (filled by `/bug`), #suggestions
- **🔊 Voice:** General, PvP
- **🔒 Staff:** #mod-log, #staff-chat (only mods see them)
- A welcome message and the rules, the Reminth server icon, members need a verified email, notifications only for
  mentions, join messages in #general, AutoMod (spam, mass pings, invite links, slurs), all slash commands.
- Pressing the button again never makes doubles - it only adds what's missing.

## What the bot can do

**Moderation** (only people with the matching Discord permission see these):
- `/ban` (choose how much of their messages to delete), `/unban`, `/kick`
- `/timeout` (60 seconds to 1 week), `/untimeout`
- `/warn`, `/warnings` (see or clear someone's warnings)
- `/purge` 1-100 messages (or only one person's)
- They get a DM saying why; everything goes into #mod-log. Mods can't act on people ranked equal or higher.

**Auto-moderation** (`/automod setup`, `/automod status`, `/automod off`):
spam, mass pings (blocked + 10 minute timeout), invite links to other servers, slurs and sexual content (swearing optional).

**For everyone:** `/download`, `/changelog`, `/help`, `/bug` (a form -> #bug-reports), `/account`, `/verify` (Reminth Player role).

**Only you:** `/pull` (adds everyone who signed in with Discord, with the Reminth Player role), `/stats`.

**Automatic:** every GitHub release is posted in #updates.

---

## Later
- Google sign-in - ask me when you want it.
- Marketing posts: `marketing\posts.md`.
