# Next: switch on the Reminth bot in your server (about 15 minutes)

The bot sets up your existing server for you. Your channels stay as they are.
Do one step at a time. If something looks different, stop and tell me what you see.
The Bot Token is a password: never send it to anyone, not even me.

---

### 1. Copy 4 things into Notepad
- **Public Key:** https://discord.com/developers/applications -> **Reminth** -> next to **Public Key** -> **Copy**
- **Bot Token:** left menu **Bot** -> **Reset Token** -> **Yes, do it!** -> **Copy**
- **Your ID:** Discord -> cog (User Settings) -> **Advanced** -> **Developer Mode** ON -> click your name (bottom left) -> **Copy User ID**
- **Server ID:** right-click the **Reminth Launcher** server icon -> **Copy Server ID**

### 2. Two switches on the Bot page
Developer portal -> **Reminth** -> left menu **Bot**:
- **Public Bot** -> OFF
- **Server Members Intent** -> ON (needed for the 24 hour timeout of new accounts)
-> **Save Changes**

### 3. Put the 4 things into Cloudflare
https://dash.cloudflare.com -> **Workers & Pages** -> **reminth** -> **Settings** -> **Variables and Secrets** -> **Add**, then **Save**:

| Name                 | Type   | Paste      |
|----------------------|--------|------------|
| `DISCORD_PUBLIC_KEY` | Text   | Public Key |
| `DISCORD_BOT_TOKEN`  | Secret | Bot Token  |
| `ADMIN_DISCORD_ID`   | Text   | your ID    |
| `DISCORD_GUILD_ID`   | Text   | server ID  |

**One more permission for the token** (so the bot can check things every minute):
Cloudflare -> your profile picture (top right) -> **My Profile** -> **API Tokens** -> at the token GitHub uses, **...** -> **Edit** ->
**Add more** permission: **Account** | **Workers Scripts** | **Edit** -> **Continue to summary** -> **Update Token**.

Then GitHub -> **Actions** -> **Website to Cloudflare** -> **Run workflow** -> **Run workflow**. Wait for the green tick.

### 4. Tell Discord where the bot is
Developer portal -> **Reminth** -> **General Information** -> **Interactions Endpoint URL**:
`https://reminth.pages.dev/api/discord/interactions` -> **Save Changes**.

### 5. Invite the bot
Left menu **OAuth2** -> **OAuth2 URL Generator** -> tick **bot** and **applications.commands** -> tick **Administrator** ->
open the link at the bottom -> pick **Reminth Launcher** -> **Authorize**.
Then Discord -> **Server Settings** -> **Roles** -> drag the **Reminth** bot role to the **very top**.

### 6. One more chat channel
Discord's onboarding needs 5 channels where members can write. You have 4 (general, clips, suggestions, commands).
Add one more in **Community**, for example `off-topic` - or tell me which other channel members should be able to write in.

### 7. Press "Set up my server"
https://reminth.pages.dev/account (signed in with Discord) -> **Owner tools** -> **Set up my server**.
It shows what it found -> **OK**. Wait for **Done**.

### 8. The texts
Read `discord\texts.md` and tell me what to change. When it's good: **Post the channel messages** on the account page.

### 9. Tickets v2
Set up your panels in #support and #application with texts 6 and 7 from `discord\texts.md`.
Support team: **Admin, Moderator, Helper**.

Tell me "done" and what you see.
