# What you need to do (9 Oct 2026)

Everything below is built, tested and pushed. Only these steps need **your** logins, so I couldn't do them.
Reminth **1.7.0** is already installed on your PC - open it and look around first.

---

## 1. Publish the app update (2 minutes)

GitHub -> **Releases** -> **Draft a new release**

- **Tag:** `1.7.0` (target **main**) - **Title:** `Reminth 1.7.0`
- **Files:** all three from `release-1.7.0\`: `Reminth-Setup.exe`, `Reminth-Setup.exe.blockmap`, `latest.yml`
- **Description** (paste):

```
## Reminth 1.7.0
- Reminth accounts: sign in with Discord in Settings - the same account works on the website. Optional; nothing needs one.
- Pick your look: Settings -> Theme -> Orange or Blue. The whole launcher changes, the icon included.
- Fixed: clicking Reminth on the taskbar could open a second taskbar button.
```

Players get it through auto-update.

## 2. The website - nothing to do

It's already live (it publishes itself now): new **Sign in** link, an **Account** page, Privacy Policy v9 and
Terms v7 (they describe the new accounts - read them once, they carry your name).

## 3. Switch Reminth accounts on (about 10 minutes, once)

Until you do this, the app and the website say "Reminth accounts are coming soon" - nothing is broken.

**a) Make the Discord app** - https://discord.com/developers/applications

1. **New Application** -> name it `Reminth` -> Create.
2. Left menu **OAuth2**.
3. Copy the **Client ID** (keep it for step c).
4. **Client Secret** -> **Reset Secret** -> copy it (keep it for step c - it's a password, don't post it anywhere).
5. **Redirects** -> **Add Redirect** -> paste exactly:
   `https://reminth.pages.dev/api/auth/discord/callback` -> **Save Changes**.

**b) Make the database** - Cloudflare dashboard

1. Left menu **Storage & Databases** -> **D1 SQL Database** -> **Create** -> name `reminth-accounts` -> Create.
   (Reminth makes its tables by itself - you don't run anything.)

**c) Connect both to the website** - Cloudflare -> **Workers & Pages** -> project **reminth** -> **Settings**

1. **Bindings** -> **Add** -> **D1 database** -> Variable name: `DB` -> database: `reminth-accounts` -> Save.
2. **Variables and Secrets** -> **Add**:
   - `DISCORD_CLIENT_ID` -> type **Text** -> the Client ID
   - `DISCORD_CLIENT_SECRET` -> type **Secret** -> the Client Secret
   (both for **Production**) -> Save.

**d) Make it take effect** - GitHub -> **Actions** -> **Website to Cloudflare** -> **Run workflow**.

**e) Try it** - open https://reminth.pages.dev/account -> **Continue with Discord**. Then in the app:
Settings -> Account -> **Continue with Discord** -> your browser opens -> approve -> it asks to open Reminth -> yes.

If something says "error", tell me what it says.

## 4. Test list (5 minutes)

1. Taskbar: close Reminth, click your pinned Reminth icon -> it opens **on that icon**, no second button. PASS/FAIL
   (If you still see two: right-click the old pinned icon -> Unpin, open Reminth, right-click its button -> Pin.)
2. Settings -> Theme -> **Blue**: everything turns blue, the cube too (taskbar icon as well). **Orange** turns it back. PASS/FAIL
3. After step 3 above: sign in with Discord in the app and on the website - same name both places. PASS/FAIL
4. Website account page: Sign out, sign in again, then try **Delete my account** (you can sign up again after). PASS/FAIL

## Good to know

- The blue theme changes the window/taskbar icon while Reminth runs. The desktop shortcut and the installer stay
  orange (Windows takes those from the .exe itself).
- Next on the list (you asked me to remind you): **marketing** - Reddit posts, short clip ideas, a Discord text.
