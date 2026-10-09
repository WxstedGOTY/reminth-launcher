# What you need to do (9 Oct 2026, evening) - follow it top to bottom

Everything is built, tested and pushed. These steps need **your** logins, so only you can do them.
Do them **in this order**. Each one says exactly what to click. If a button has a slightly different name on your
screen, pick the closest one, or tell me what you see.

**Never paste a secret (Client Secret, Bot Token) into a chat, Discord or anywhere public.** Only into Cloudflare.
Keep the secrets in Notepad while you work and delete that note when done.

You will collect these 7 values (write them into Notepad as you go):

| Name in Cloudflare      | What it is                        | Secret? |
|-------------------------|-----------------------------------|---------|
| `DISCORD_CLIENT_ID`     | Discord app's Client ID           | no      |
| `DISCORD_CLIENT_SECRET` | Discord app's Client Secret       | **yes** |
| `DISCORD_BOT_TOKEN`     | Discord app's Bot Token           | **yes** |
| `ADMIN_DISCORD_ID`      | **your own** Discord user ID      | no      |
| `GOOGLE_CLIENT_ID`      | Google's Client ID                | no      |
| `GOOGLE_CLIENT_SECRET`  | Google's Client Secret            | **yes** |
| `DISCORD_GUILD_ID`      | your Discord **server's** ID - later, once you made the server | no |

---

## Step 1 - The Discord app (5 min)

Go to https://discord.com/developers/applications and log in with your Discord.

1. Top right **New Application** -> name: `Reminth` -> tick the box -> **Create**.
2. Left menu **OAuth2**:
   - Copy **Client ID** -> Notepad as `DISCORD_CLIENT_ID`.
   - **Client Secret** -> **Reset Secret** -> **Yes, do it!** -> **Copy** -> Notepad as `DISCORD_CLIENT_SECRET`.
   - **Redirects** -> **Add Redirect** -> paste exactly: `https://reminth.pages.dev/api/auth/discord/callback`
   - Bottom: **Save Changes**.
3. Left menu **Bot**:
   - **Reset Token** -> **Yes, do it!** -> **Copy** -> Notepad as `DISCORD_BOT_TOKEN`.
   - Switch **Public Bot** OFF (so only you can add it to servers) -> **Save Changes**.
     If it says "Private application cannot have a default authorization link": left menu **Installation** ->
     **Install Link** -> **None** -> **Save Changes**, then come back and switch Public Bot OFF.
   - Leave everything else on this page as it is.
4. Your own Discord user ID: in the Discord app -> **User Settings** (cog) -> **Advanced** -> turn on
   **Developer Mode**. Close settings, click your own name/picture (bottom left) -> **Copy User ID**
   -> Notepad as `ADMIN_DISCORD_ID`. This makes the "Owner tools" box appear only for you.

## Step 2 - The Google sign-in (10 min) - you can skip this; then there's just no Google button

Go to https://console.cloud.google.com and log in with the Google account you want to own this.

1. Top bar, the project picker (next to "Google Cloud") -> **New Project** -> name `Reminth` -> **Create**.
   When it's made, make sure `Reminth` is picked in the top bar.
2. Search bar at the top: type `Google Auth Platform` (older name: `OAuth consent screen`) -> open it -> **Get started**:
   - App name: `Reminth` - User support email: your email -> **Next**
   - Audience: **External** -> **Next**
   - Contact information: your email -> **Next** -> tick the agreement -> **Continue** -> **Create**.
3. Left menu **Branding**: App home page `https://reminth.pages.dev` - Privacy policy
   `https://reminth.pages.dev/privacy.html` - Terms of service `https://reminth.pages.dev/terms.html` -> **Save**.
4. Left menu **Audience** -> **Publish app** -> **Confirm**. (Without this, only test users could sign in.
   Reminth only asks for name + picture, so Google doesn't need to review it.)
5. Left menu **Clients** -> **Create client**:
   - Application type: **Web application** - Name: `Reminth website`
   - **Authorized redirect URIs** -> **Add URI** -> paste exactly: `https://reminth.pages.dev/api/auth/google/callback`
   - **Create** -> copy **Client ID** -> Notepad as `GOOGLE_CLIENT_ID`, copy **Client secret** -> Notepad as
     `GOOGLE_CLIENT_SECRET`. (If it doesn't show the secret, open the client again - it's on the right.)

## Step 3 - The database (2 min)

Cloudflare dashboard (https://dash.cloudflare.com):

1. Left menu **Storage & Databases** -> **D1 SQL Database** -> **Create** -> name `reminth-accounts` -> **Create**.
   Reminth makes its own tables - you don't type anything in there.

## Step 4 - Connect it all to the website (5 min)

Cloudflare -> **Workers & Pages** -> click the project **reminth** -> **Settings**.

1. **Bindings** -> **Add** -> **D1 database** -> Variable name: `DB` -> database: `reminth-accounts` -> **Save**.
2. **Variables and Secrets** -> **Add**, one per value from your Notepad (for **Production**):
   - `DISCORD_CLIENT_ID` -> type **Text**
   - `DISCORD_CLIENT_SECRET` -> type **Secret**
   - `DISCORD_BOT_TOKEN` -> type **Secret**
   - `ADMIN_DISCORD_ID` -> type **Text**
   - `GOOGLE_CLIENT_ID` -> type **Text** (skip if you skipped step 2)
   - `GOOGLE_CLIENT_SECRET` -> type **Secret** (skip if you skipped step 2)
   - -> **Save**.

## Step 5 - Make it take effect (1 min)

GitHub -> your repo -> **Actions** -> **Website to Cloudflare** -> **Run workflow** -> **Run workflow**.
Wait for the green tick (about a minute).

## Step 6 - Try it on the website (3 min)

Open https://reminth.pages.dev/account

1. You see **Continue with Discord**, **Continue with Google** and **Continue with email**. PASS/FAIL
2. **Continue with Discord** -> Discord asks to allow Reminth (it lists "Join servers for you" - that's the
   server feature) -> **Authorize** -> you're back on the page with your name and picture. PASS/FAIL
3. Below your account there's an **Owner tools** box (only you see it). It says
   "To use the button, add in Cloudflare: DISCORD_GUILD_ID" - correct for now. PASS/FAIL
4. Under "Connected", press **Connect** next to Google -> pick your Google account -> it says
   "Google is connected". PASS/FAIL
5. **Sign out** -> **Continue with email** -> **Create account** with a test gamer tag, any email, a password ->
   you're signed in. Then **Delete my account** for that test account. PASS/FAIL

If any step shows an error, tell me the exact words.

## Step 7 - Install Reminth 1.7.0 on your PC and try it (5 min)

**Close Minecraft and Reminth first.** Then run `release-1.7.0\Reminth-Setup.exe`.

1. Reminth opens **blue** (the new default) on a **"Create your Reminth account"** screen with the two-step
   tracker (1 Reminth account -> 2 Minecraft). PASS/FAIL
2. **Pick your look** -> **Orange** turns everything orange, **Blue** turns it back. Keep the one you like. PASS/FAIL
3. **Continue with Discord** -> browser -> Authorize -> "Open Reminth?" -> yes -> step 1 gets a green tick.
   Because you're already signed in to Microsoft, you go straight to Home. PASS/FAIL
4. Top right shows **your Reminth name and picture**, and under it "Playing as <your Minecraft name>". PASS/FAIL
5. Settings -> Account: both accounts listed. Taskbar: no second Reminth button. PASS/FAIL

## Step 8 - Publish the update (2 min) - only after steps 6 and 7 passed

GitHub -> **Releases** -> **Draft a new release**

- **Tag:** `1.7.0` (target **main**) - **Title:** `Reminth 1.7.0`
- **Files:** all three from `release-1.7.0\`: `Reminth-Setup.exe`, `Reminth-Setup.exe.blockmap`, `latest.yml`
- **Description** (paste):

```
## Reminth 1.7.0
- Reminth accounts: sign in with Discord, Google or email. Your account shows at the top of the launcher, and the same account works on reminth.pages.dev.
- Pick your look: blue (new default) or orange - the whole launcher changes, the icon too. On the first screen or in Settings.
- Fixed: clicking Reminth on the taskbar could open a second taskbar button.
```

-> **Publish release**. Players get it through auto-update.

## Step 9 - Later: pull everyone into your Discord server

When you've made your Discord server:

1. In Discord, right-click your **server icon** -> **Copy Server ID** (Developer Mode from step 1 must be on).
2. Add the bot to your server: https://discord.com/developers/applications -> `Reminth` -> **OAuth2** ->
   **OAuth2 URL Generator** -> tick **bot** -> below, under Bot Permissions, tick **Create Instant Invite** ->
   copy the **Generated URL** at the bottom -> open it in your browser -> pick your server -> **Authorize**.
3. Cloudflare -> project **reminth** -> **Settings** -> **Variables and Secrets** -> **Add** `DISCORD_GUILD_ID`
   (type **Text**) = the server ID -> **Save**. Then GitHub -> Actions -> **Website to Cloudflare** -> **Run workflow**.
4. https://reminth.pages.dev/account (signed in with your Discord) -> **Owner tools** ->
   **Add everyone to my Discord server**. It shows how many were added. Press it again any time for new players.

Who gets added: everyone who signed in with **Discord** and didn't untick "Add me to the Reminth Discord server".
Google/email-only players can't be added (Discord doesn't allow it) - they can press **Connect** next to Discord on
the account page, then they can be.

## Good to know

- Blue is the default for everyone who never picked a look, so players who update will see blue once.
  Anyone who picked orange keeps orange.
- The desktop shortcut and the installer icon stay orange (Windows takes those from the .exe).
- Email accounts: there's no "forgot password" yet (Reminth sends no emails). If someone is locked out, they email you.
- If the account server is down, the launcher doesn't block anyone - it just skips the account step.
- Next on the list (you asked me to remind you): **marketing** - Reddit posts, short clip ideas, a Discord text.
