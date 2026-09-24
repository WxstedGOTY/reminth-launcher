New round. Read this whole file first.

## First: rebuild
Run the build (`npm run dist` or `build-dist.bat`). Confirm it finishes with no
errors and a new `Reminth-Setup.exe` lands in `dist\`. Don't install it
yourself — the user will.

## Second: figure out the NeoForge mismatch before the user retests it
`instances/neoforge-26-3-0050/` has no `options.txt`, no `logs/`, no
`launch-logs/neoforge-26-3-0050.txt` — nothing a real launch would create,
even though the last report said NeoForge launched fine. Check whether
there's another NeoForge instance folder the earlier test might have
actually used, or any other explanation on disk. Update `REMINTH_STATE.md`
with a real answer instead of "ASSUMED" — don't just re-guess.

## Then write the user a short manual test checklist in REMINTH_STATE.md
Plain list, in this order, for the user to run by hand after installing the
new build:
1. Confirm the launcher opens already maximized.
2. Sign out — confirm ONLY the sign-in card shows (no rail, no instance
   list, no sidebar counts). Sign back in — confirm everything returns.
3. Launch the Forge instance (`forge-26-3-ff87`) — confirm it boots. If it
   crashes, they'll paste you the last ~30 log lines next round.
4. Launch NeoForge again, freshly, and confirm which instance actually ran.
5. On the original Fabric 26.2 instance, press H in-game and confirm
   ReminthHUD actually renders on screen.

## Before you finish
Commit and push (build output itself doesn't need to be committed, just the
code/report changes). Don't start any of the 5 manual tests yourself —
those need the user clicking through the real app.
