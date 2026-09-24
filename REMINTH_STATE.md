# REMINTH_STATE — local Windows machine report

Written by local Claude Code, 2026-09-24 (round 2). Every claim is labelled
VERIFIED (ran it, saw it), ASSUMED, or UNTESTED.

This replaces the round 1 report (commit 8a0fc9e/39f7f47). It covers what changed since then.

## Git

`git log --oneline -15` (VERIFIED, taken before this report's own commit):
```
45882dc Default -Xmx to half of total RAM, clamped to 2-6GB
39f7f47 Update REMINTH_STATE.md: remote fixed, pushing
8a0fc9e Add REMINTH_STATE.md report for cloud session
f7a04a5 Merge GitHub main (site pages, v1.1.0 tag history) into local main
8fedbcc Commit local backlog: loaders, instances, Modrinth, skins, recorder, heroPlaytime fix
446dbdf Add Privacy/Terms pages, pin installer artifact name, and point downloads at /latest/
175d901 Update index.html
dc627c4 Create index.html
8dd1d1a Reminth launcher: rename WxHUD to ReminthHUD, fix launch bug
b72175e Rename WxHUD to ReminthHUD, fix launch bug
3a94c0b Initial commit
```

`git status --short` (VERIFIED): empty.

`git rev-parse HEAD` == `git rev-parse origin/main` (VERIFIED after `git fetch origin`,
before this report's commit): both `45882dc6cb31a16abaf821a7ecbcf7fc12dfe1af`. Step 1 had
nothing to push. The only new commit this round is this report, pushed as a fast-forward.

## Environment

- Windows: `Microsoft Windows [Version 10.0.22631.6199]` (VERIFIED)
- Node: `v24.21.0` (VERIFIED)
- Electron (`node_modules/electron/package.json`): `33.4.11` (VERIFIED)
- Java downloaded by Reminth (VERIFIED): one JDK at `%APPDATA%\Reminth\java\`, `release` says
  `JAVA_VERSION="25.0.4.1"`. `%APPDATA%\Reminth\runtimes\` still does not exist.

## What I asked for this round

This round's request:
```
Read CLAUDE_CODE_PROMPT.md and follow it
```
The request between the two reports (it produced 45882dc):
```
Fix computeDefaultMaxMemoryMB in src/main/minecraft.js to match the test (half of total RAM, clamped 2-6GB), commit, and push
```

## What you did

Files changed since the round 1 report:
- `src/main/minecraft.js`: `computeDefaultMaxMemoryMb` now returns
  `min(6144, max(2048, floor(totalMB / 2)))` instead of 1024/2048. This matches
  `test/minecraft.test.js`. Callers are `main.js:231` (settings default shown in the UI), `main.js:551`
  (launch, still capped by `entitlements.ramCapMb()`) and `minecraft.js:391`. None of them changed.
- `REMINTH_STATE.md`: this file.

Commands:
| command | result |
|---|---|
| `git status --short` | pass. Empty |
| `git fetch origin`, `git log origin/main..HEAD`, `git log HEAD..origin/main` | pass. Both empty, nothing to push or pull |
| `npm test` | VERIFIED pass: `tests 53`, `pass 53`, `fail 0` |
| `git push origin main` (for 45882dc, previous turn) | pass: `39f7f47..45882dc  main -> main` |

## Test results

| test | status | evidence |
|---|---|---|
| `npm test` (node --test, 53 tests) | VERIFIED pass | `ℹ tests 53` / `ℹ pass 53` / `ℹ fail 0` |
| `computeDefaultMaxMemoryMb` 4/8/16 GB → 2/4/6 GB | VERIFIED pass | covered by `test/minecraft.test.js:268` |
| Memory default in a real launch | UNTESTED | No game launched this round |
| Fresh device-code sign-in (`login_with_xbox`) | UNTESTED | Needs the user to sign in with a Microsoft account in a browser |
| Silent refresh on Play (`refreshSession`) | UNTESTED | No temporary log added, no launch done |
| Multiplayer join on a saved server | UNTESTED | |
| Fabric / Forge / NeoForge / Quilt launches | UNTESTED this round | Handoff says Fabric worked in an earlier session. Not re-run |
| ReminthHUD loader and version coverage | UNTESTED | |

## Broken or weird

1. The round 1 failing test (`computeDefaultMaxMemoryMb`) is fixed in 45882dc.
2. Behaviour change to be aware of: with no memory setting saved, a 16 GB machine now
   defaults to 6 GB heap (was 2 GB), and an 8 GB machine to 4 GB (was 2 GB). ASSUMED fine, since the
   test encodes this as the intended behaviour.
3. Still open from round 1: commits `fe297f7` / `39b1a4c` from the handoff exist neither
   here nor on GitHub.
4. `paths.js` still mentions `javaRuntime.js`, which doesn't exist (VERIFIED last round, unchanged).

## Open questions for the cloud session

1. Do you still have `fe297f7` / `39b1a4c`? If so, push them as a branch so they can be merged.
2. `package-lock.json`: do you want GitHub's newer `brace-expansion` pins (dropped in the f7a04a5 merge) restored?
3. The live tests (sign-in, refresh, multiplayer, the four loaders, HUD) need the user at the
   keyboard with a Microsoft account. They are the highest-value next step. Should the next round
   add the temporary `login_with_xbox` status/body log and the `refreshSession` catch log in advance?
