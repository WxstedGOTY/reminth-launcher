# Your steps - one small thing at a time

**Where you are (9 Oct 2026):** Part A DONE (accounts + email on). Part B DONE (Discord on - checked live).
**Next: Part C.**

Do **one part**, then tell me **"Part A done"** (or what went wrong). I'll check it works before you do the next one.
Every line is one click or one paste. If a button looks different on your screen, stop and tell me what you see.

Open **Notepad** now. You'll paste a few codes into it as you go.

---

## Part A - Turn on accounts with email (5 minutes)

**A1. Make the database**
1. Open https://dash.cloudflare.com and log in.
2. In the left menu, click **Storage & Databases**.
3. Click **D1 SQL Database**.
4. Click the blue **Create** button.
5. In the name box, type: `reminth-accounts`
6. Click **Create**.

**A2. Connect the database to the website**
1. In the left menu, click **Workers & Pages**.
2. Click **reminth**.
3. Click the **Settings** tab at the top.
4. Find **Bindings** and click **Add**.
5. Pick **D1 database**.
6. Variable name: type `DB` (capital letters).
7. Database: pick `reminth-accounts`.
8. Click **Save**.

**A3. Restart the website**
1. Open your repo on GitHub.
2. Click the **Actions** tab at the top.
3. On the left, click **Website to Cloudflare**.
4. On the right, click **Run workflow**, then the green **Run workflow** button.
5. Wait until it shows a green tick (about 1 minute).

Tell me **"Part A done"**. I'll check that email sign-in works.

---

## Part B - Add "Continue with Discord" (10 minutes)

**B1. Make the Discord app**
1. Open https://discord.com/developers/applications and log in.
2. Click **New Application** (top right).
3. Name: `Reminth`. Tick the box. Click **Create**.

**B2. Copy two codes**
1. In the left menu, click **OAuth2**.
2. Under **Client ID**, click **Copy**. Paste it into Notepad and write `CLIENT ID` next to it.
3. Under **Client Secret**, click **Reset Secret**, then **Yes, do it!**, then **Copy**. Paste it into Notepad and
   write `SECRET` next to it. (This one is like a password - never send it to anyone, not even me.)

**B3. Add the redirect**
1. Still on the OAuth2 page, find **Redirects** and click **Add Redirect**.
2. Paste exactly this:
   `https://reminth.pages.dev/api/auth/discord/callback`
3. Click **Save Changes** (green bar at the bottom).

**B4. Put the codes into Cloudflare**
1. Go back to https://dash.cloudflare.com, then **Workers & Pages**, then **reminth**, then **Settings**.
2. Find **Variables and Secrets** and click **Add**.
3. Type: **Text**. Variable name: `DISCORD_CLIENT_ID`. Value: your `CLIENT ID` from Notepad.
4. Click **Add variable** (or **+ Add**) for a second one.
5. Type: **Secret**. Variable name: `DISCORD_CLIENT_SECRET`. Value: your `SECRET` from Notepad.
6. Click **Save**.

**B5. Restart the website** - same as A3 (GitHub, then Actions, then Website to Cloudflare, then Run workflow).

Tell me **"Part B done"**.

---

## Part C - Try it (5 minutes)

**C1. On the website**
1. Open https://reminth.pages.dev/account
2. Click **Continue with Discord**, then **Authorize**.
3. You should see your Discord name and picture. Tell me yes or no.

**C2. In the app**
1. Close Minecraft and Reminth.
2. Open the folder `Downloads\reminth-launcher\release-1.7.0` and double-click `Reminth-Setup.exe`.
3. Reminth opens (blue) on "Create your Reminth account".
4. Click **Continue with Discord**. Your browser opens. Click **Authorize**. When the browser asks to open
   Reminth, click **Open**.
5. Top right in Reminth should show your Discord name. Tell me yes or no.

---

## Part D - Publish the update (2 minutes) - only after Part C worked

1. On GitHub, click **Releases** (right side of your repo), then **Draft a new release**.
2. Tag: type `1.7.0`, then click **Create new tag**. Title: `Reminth 1.7.0`
3. Drag in the 3 files from `release-1.7.0`: `Reminth-Setup.exe`, `Reminth-Setup.exe.blockmap`, `latest.yml`
4. Paste this as the description:

```
## Reminth 1.7.0
- Reminth accounts: sign in with Discord or email. Your account shows at the top of the launcher, and the same account works on reminth.pages.dev.
- Pick your look: blue (new default) or orange - the whole launcher changes, the icon too.
- Fixed: clicking Reminth on the taskbar could open a second taskbar button.
```

5. Click **Publish release**.

---

## Later (not now)

- **Google sign-in** - ask me when you want it; I'll walk you through it.
- **Pulling people into your Discord server** - when your server exists, tell me and I'll give you those steps
  (it needs 3 more codes). Everyone who signs in with Discord from now on can be pulled in later.
- Then: **marketing**.
