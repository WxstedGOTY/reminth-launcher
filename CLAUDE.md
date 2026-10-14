# Notes for Claude Code sessions in this repo

- **New chat? Read `HANDOFF_FULL.md` first** (the complete hand-off of the 3-6 Oct 2026 work: owner, rules, features,
  releases, open items). Local-only chat logs are in `local-notes/` (git-ignored).

- **Anything about the launcher's look (since 15 Oct 2026): read `design/NIGHT_DESIGN.md`** - the owner's Night design,
  his Moonrise icon (`design/icon/`), the rules (no Pixelify digits, cream = press me, no fake data), what's left.
  To look at the UI without touching the owner's screen or data, use `tools/preview/` (README there).

- The rules for working on Reminth are in `CLAUDE_CODE_HANDOFF_10.md` sections 0-1.
- There used to be two Claude Code windows (a cloud one that wrote code, a desktop one on the owner's Windows PC that
  tests and builds). Since 4 Oct 2026 only the desktop window works; it still keeps **`DECISIONS_AND_TEST_PLAN.md`** current.
- **Every time you finish a batch of work** (before your final message), rewrite
  `DECISIONS_AND_TEST_PLAN.md` so it is current: what changed (with file names), the commit `main` is at and
  the `npm test` count, decisions the owner must make (recommendation first, closed ones moved to "Closed"),
  known weak spots, and a numbered PASS/FAIL test plan for the other window covering everything not yet
  tested for real. Commit it and push it with the work. Tell the owner you updated it.
