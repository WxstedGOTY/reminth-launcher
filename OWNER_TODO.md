# Your steps - one small thing at a time

**Where you are (10 Oct 2026):** 1.7.0 is published. Accounts (Discord + email) are live.
**Next: Part E - switch on the Reminth bot** (after your Discord server exists).

Do one step, then the next. If a screen looks different, stop and tell me what you see.
**Never send the Bot Token to anyone, not even me.** It goes only into Cloudflare.

---

## Part E - The Reminth bot (about 20 minutes)

You'll put 4 things into Cloudflare. Open Notepad to keep them while you work.

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
1. Right-click your **server icon** on the left -> **Copy Server ID**. Paste it into Notepad.

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
3. Under **Bot Permissions**, tick: **Manage Server**, **Manage Roles**, **Kick Members**, **Ban Members**,
   **Create Instant Invite**, **Moderate Members**, **View Channels**, **Send Messages**, **Embed Links**,
   **Manage Messages**, **Read Message History**.
4. Copy the **Generated URL** at the bottom, open it in your browser, pick your server -> **Authorize**.

**E9. Put the bot's role at the top**
In Discord: **Server Settings** -> **Roles** -> drag the **Reminth** role to the very top (above your mod roles).
The bot can only moderate people whose roles are below its own.

**E10. Install the commands**
1. Open https://reminth.pages.dev/account (signed in with your Discord).
2. In **Owner tools**, click **Set up the bot's commands**. It says how many commands are in your server.

**E11. Set the bot up in your server** (type these in any channel)
1. `/config modlog` -> pick **#mod-log**
2. `/config bugs` -> pick **#bug-reports**
3. Make a role called **Reminth Player** (Server Settings -> Roles), keep it **below** the Reminth bot role,
   then `/config player-role` -> pick it.
4. `/automod setup` -> pick if swear words should be blocked too.

**E12. Release posts in #updates**
1. In Discord: hover **#updates** -> the cog (Edit Channel) -> **Integrations** -> **Webhooks** -> **New Webhook**.
2. Click the new webhook, name it `Reminth`, then **Copy Webhook URL**.
3. GitHub -> your repo -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**:
   - Name: `DISCORD_UPDATES_WEBHOOK`
   - Secret: paste the webhook URL -> **Add secret**
4. Test it: GitHub -> **Actions** -> **Announce release on Discord** -> **Run workflow** -> tag `1.7.0` -> green
   **Run workflow**. "Reminth 1.7.0 is out" should appear in #updates.

Tell me **"Part E done"** and what worked.

---

## What the bot can do (once it's on)

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
