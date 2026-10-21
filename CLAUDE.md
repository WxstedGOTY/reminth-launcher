# Notes for Claude Code sessions in this repo

- **New chat? Read `HANDOFF_SPACEPORT.md` FIRST (written 21 Oct 2026), then the owner's own plan file `C:\Users\kolijos\Downloads\reminth-launcher - Copy\discord\claude prompt, how we will continue the` (no file extension; his task list / prompt for the new start; hand-off section 0): the state, the owner's plan (no releases yet,
  GitHub starts from zero, he is writing a long change list), rules, recipes, open decisions. `HANDOFF_FULL.md` is the
  complete older history (3-6 Oct 2026; it still says "Reminth"). Local-only chat logs are in `local-notes/` (git-ignored).

- **Anything about the launcher's look (since 15 Oct 2026): read `design/NIGHT_DESIGN.md`** - the owner's Night design,
  his Moonrise icon (`design/icon/`), the rules (no Pixelify digits, cream = press me, no fake data), what's left.
  To look at the UI without touching the owner's screen or data, use `tools/preview/` (README there).

- **Since 16-17 Oct 2026 the launcher is called "Spaceport Launcher"** (it was Reminth). Everything players see says
  Spaceport Launcher / Spaceport. **Hidden names stay "reminth" on purpose** - never "fix" them: `%APPDATA%\Reminth`,
  `%APPDATA%\reminth-launcher`, the package name, `appId`, `Reminth.exe` (`build.executableName`), `reminth://`, mod ids,
  class names, config files, localStorage keys, log lines, `reminth.pages.dev` as the API (old launchers use it).
  Why and what's left: `DECISIONS_AND_TEST_PLAN.md` (the 17 Oct section) and `OWNER_TODO_SPACEPORT.md`. The renamed
  website waits on the branch `spaceport-website` until the release.

- The rules for working on the launcher are in `CLAUDE_CODE_HANDOFF_10.md` sections 0-1.
- There used to be two Claude Code windows (a cloud one that wrote code, a desktop one on the owner's Windows PC that
  tests and builds). Since 4 Oct 2026 only the desktop window works; it still keeps **`DECISIONS_AND_TEST_PLAN.md`** current.
- **Every time you finish a batch of work** (before your final message), rewrite
  `DECISIONS_AND_TEST_PLAN.md` so it is current: what changed (with file names), the commit `main` is at and
  the `npm test` count, decisions the owner must make (recommendation first, closed ones moved to "Closed"),
  known weak spots, and a numbered PASS/FAIL test plan for the other window covering everything not yet
  tested for real. Commit it and push it with the work. Tell the owner you updated it.
