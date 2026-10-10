# Next: the Reminth Discord server (about 15 minutes)

The bot builds the whole server for you. You only do these 10 steps.
Do one step at a time. If something looks different, stop and tell me what you see.

Keep Notepad open - you'll paste 4 things into it.
The Bot Token is a password: never send it to anyone, not even me.

---

### 1. Make an empty server
Discord -> click **+** (bottom left) -> **Create My Own** -> **For me and my friends** -> name: `Reminth` -> **Create**.

### 2. Copy the Public Key
Open https://discord.com/developers/applications -> click **Reminth** -> next to **Public Key** click **Copy**.
Paste it into Notepad.

### 3. Copy the Bot Token
Left menu **Bot** -> **Reset Token** -> **Yes, do it!** -> **Copy**. Paste it into Notepad.

### 4. Copy your own ID
Discord -> **cog** (User Settings) -> **Advanced** -> turn on **Developer Mode** -> close.
Click your name (bottom left) -> **Copy User ID**. Paste it into Notepad.

### 5. Copy the server's ID
Right-click the new **Reminth** server icon -> **Copy Server ID**. Paste it into Notepad.

### 6. Put the 4 things into Cloudflare
https://dash.cloudflare.com -> **Workers & Pages** -> **reminth** -> **Settings** -> **Variables and Secrets** -> **Add**.
Add these 4, then **Save**:

| Name                 | Type   | Paste            |
|----------------------|--------|------------------|
| `DISCORD_PUBLIC_KEY` | Text   | Public Key (2)   |
| `DISCORD_BOT_TOKEN`  | Secret | Bot Token (3)    |
| `ADMIN_DISCORD_ID`   | Text   | your ID (4)      |
| `DISCORD_GUILD_ID`   | Text   | server ID (5)    |

Then GitHub -> **Actions** -> **Website to Cloudflare** -> **Run workflow** -> **Run workflow**. Wait for the green tick.

### 7. Tell Discord where the bot is
Developer portal -> **Reminth** -> **General Information** -> **Interactions Endpoint URL**, paste:
`https://reminth.pages.dev/api/discord/interactions`
-> **Save Changes**. (Error? Wait 1 minute and save again.)

### 8. Invite the bot
Left menu **OAuth2** -> **OAuth2 URL Generator** ->
tick **bot** and **applications.commands** -> below, tick **Administrator** ->
copy the link at the bottom -> open it -> pick **Reminth** -> **Authorize**.

### 9. Press the button
https://reminth.pages.dev/account -> **Owner tools** -> **Build my Discord server** -> **OK**.
Wait until it says **Done** (about a minute). Your server is built.

### 10. Two last things
- Discord -> **Server Settings** -> **Roles** -> drag the bot's **Reminth** role to the **top**.
- Back on the account page -> **Copy the webhook address** ->
  GitHub -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret** ->
  Name `DISCORD_UPDATES_WEBHOOK`, paste -> **Add secret**. (Now new Reminth versions get posted in #updates.)

**Done!** Type `/download` in your server, then tell me "done" and what you see.
