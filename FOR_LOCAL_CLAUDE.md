# Paste this into Claude Code on the Windows machine

You're running on my Windows machine in `C:\Users\kolijos\Downloads\reminth-launcher`.
A cloud Claude session is working on this repo too. It **cannot** see this
machine, can't run Windows or Minecraft, and only sees what's pushed to
`github.com/WxstedGOTY/reminth-launcher`. Your job this round is to get
the real state to it: push the code, then write a report file.

## Rules
- **Don't claim anything works unless you saw it work.** Label every claim
  VERIFIED (you ran it and saw the result), ASSUMED, or UNTESTED.
- **A singleplayer launch doesn't prove auth works.** Singleplayer never
  checks the token with Mojang. Only a successful `login_with_xbox`
  response or a successful multiplayer join counts.
- **Never paste secrets.** Replace every access token, refresh token,
  `--accessToken` value, `--uuid` value, `--xuid` value and `clientId` in
  logs with `<REDACTED>`. Don't paste the contents of the saved-account
  file.
- Paste raw log lines and error text. Don't paraphrase them.
- Don't force-push or rewrite history on `main`.

## Step 1: Push the backlog (do this first, every time)
```
git status
git log --oneline origin/main..HEAD
```
- If there are uncommitted changes (for example the `heroPlaytime` fix in
  `src/renderer/renderer.js`), commit them with a clear message.
- Run `git pull --rebase origin main`, then `git push origin main`.
- If the push fails, paste the exact error into the report and stop there.

## Step 2: Write `REMINTH_STATE.md` in the repo root, commit it and push it
Use exactly these sections:

### Git
- Output of `git log --oneline -15`
- Output of `git status --short` (it should be empty after the push)
- Confirmation that `git rev-parse HEAD` equals `git rev-parse origin/main`

### Environment
- Windows version, Node version (`node -v`), Electron version from `node_modules/electron/package.json`
- Java versions Reminth has downloaded, and where they live

### What I asked for this round
- Paste my request word for word.

### What you did
- Files changed, one line per file saying why.
- Commands you ran and whether each one passed or failed.

### Test results
One row per test: `test | VERIFIED pass / VERIFIED fail / UNTESTED | evidence`.
Cover whichever of these were in scope this round:
- Fresh device-code sign-in. Sign out first, or delete the saved-account
  file and note its path. Record the HTTP status and the error body (with
  secrets redacted) of the `login_with_xbox` call. If it isn't logged,
  add a temporary `console.log` of the status and body, and don't log
  tokens.
- Silent refresh on Play. Did `refreshSession` throw? `src/main/main.js`
  currently hides that error in a bare `catch {}`, so add a temporary log
  there to find out.
- Multiplayer join on one of the saved servers. Record the exact
  disconnect message if it fails.
- A launch with each loader (Fabric, Forge, NeoForge, Quilt): MC version,
  loader version, mod count, crash yes or no, and the last 30 log lines on
  a crash.
- ReminthHUD: which loader and version combinations did it load on?

### Broken or weird
- Anything else that failed or looked wrong, with the raw error text.

### Open questions for the cloud session
- Decisions you couldn't make, or things you need from it.

## Step 3: Tell me
Tell me the pushed commit hash, then say "pushed". I'll relay that to the
cloud session.
