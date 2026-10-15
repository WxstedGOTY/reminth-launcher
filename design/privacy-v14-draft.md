# Privacy policy version 14 - draft for the release that adds Friends (NOT live yet)

Why: from the release that has Friends on Home (built 15 Oct 2026, code `functions/_friends.js`,
`functions/api/friends/*`, `src/main/presence.js`), the Reminth server stores new things for players who use a
Reminth account in the launcher. Version 13 (live) doesn't mention any of it.

Not put into `site/` yet on purpose: no published launcher sends any of this data until that release, and anything
pushed under `site/` goes live at once. **Do this in the same push as the release's website texts.**

1. In `site/privacy.html`, change the "Last updated" line to
   `<p class="updated">Last updated: <DAY> <MONTH> 2026 · Version 14</p>`.
2. In the Reminth account list (after the "What we store" item), add:

```html
      <li>
        <b>Friends (in the launcher, from Reminth <VERSION>):</b> your account gets a friend code (like K7QX-2MPA) that you
        can share. We store who you are friends with and the friend requests you sent or got (who, and when). While
        the launcher is open and you have a Reminth account, it tells us every 2 minutes whether it's open, whether
        a game is running, the Minecraft name you play as and - while a game runs - the address of the server that
        game joined (read from the game's own log). We keep only the latest of these with its time, never a
        history, and show them <b>only to your accepted friends</b>; after 5 minutes without a word you show as
        offline. <b>Appear offline</b> (on the Friends card) hides all of it from your friends. With streamer mode's
        "hide personal info" on, no server address is sent. When you quit, the launcher says you went offline.
        <b>Legal basis:</b> providing the friends feature you use (Art. 6(1)(b)). <b>Retention:</b> a friendship or
        request until either of you removes or declines it; the code and the latest status until you delete the
        account.
      </li>
```

3. In "Deleting": add "its friend code, friendships, friend requests and latest status" to what "Delete my account"
   removes.
4. At the top of "Version history":

```html
      <li><b>Version 14, <DAY> <MONTH> 2026</b>: Friends in the launcher - friend codes, friendships and requests, and
        what friends see about you (launcher open, playing, the server, your Minecraft name), only for accepted friends.</li>
```

Also update the launcher's short privacy summary in `src/renderer/index.html` (Settings -> Privacy) the same day.
