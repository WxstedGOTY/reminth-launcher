# Privacy policy version 13 - draft for Reminth 1.8.0 (NOT live yet)

Why: from 1.8.0, the launcher's Home (the "PvP tiers" card) asks the three public tier lists about the
**signed-in player's own** Minecraft account ID. Today `site/privacy.html` (version 12) only describes the in-game
Tier Tagger asking about *other* players.

Not put into `site/` yet on purpose: anything pushed under `site/` goes live on reminth.pages.dev at once
(`.github/workflows/cloudflare.yml`), and website texts wait until the owner publishes the release.
**Do this when 1.8.0 is published** (same push as the website's 1.8.0 texts):

1. In `site/privacy.html`, change the "Last updated" line to:
   `<p class="updated">Last updated: <DAY> October 2026 · Version 13</p>`
2. In the same file, in the `<ul>` that holds the **Tier Tagger** item (the list after "Reminth's own HUD mod runs
   locally and sends nothing anywhere, with one exception..."), add this item after the Tier Tagger one, and change
   "with one exception you can switch off" to "with the exceptions below":

```html
      <li><b>PvP tiers on the launcher's Home</b> (from Reminth 1.8.0): to show your own PvP tiers, the launcher asks
        <b>MCTiers</b> (mctiers.com), <b>PvPTiers</b> (pvptiers.com) and <b>SubTiers</b> (subtiers.net) about
        <b>your Minecraft account ID</b> - nothing else (no name, no sign-in token). Minecraft account IDs are
        public. It asks at most about once every 30 minutes while Reminth is open, and the answer is only kept in
        memory. These sites are run by others under their own privacy policies.</li>
```

3. At the top of "Version history", add:

```html
      <li><b>Version 13, <DAY> October 2026</b>: from Reminth 1.8.0 the launcher's Home shows your own PvP tiers -
        it asks the three public tier lists about your Minecraft account ID.</li>
```

The code that does this: `src/main/tiers.js` (only `https://mctiers.com/api/v2/profile/<id>`,
`https://pvptiers.com/api/profile/<id>`, `https://subtiers.net/api/v2/profile/<id>`, User-Agent
`Reminth (https://reminth.pages.dev)`), called from `ipcMain.handle("tiers:mine")` in `src/main/main.js`.
