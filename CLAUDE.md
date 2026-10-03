# Notes for Claude Code sessions in this repo

- The rules for working on Reminth are in `CLAUDE_CODE_HANDOFF_10.md` sections 0-1.
- Two Claude Code windows work on this repo (a cloud one that writes code, a desktop one on the owner's
  Windows PC that tests and releases). They hand work over through **`DECISIONS_AND_TEST_PLAN.md`**.
- **Every time you finish a batch of work** (before your final message), rewrite
  `DECISIONS_AND_TEST_PLAN.md` so it is current: what changed (with file names), the commit `main` is at and
  the `npm test` count, decisions the owner must make (recommendation first, closed ones moved to "Closed"),
  known weak spots, and a numbered PASS/FAIL test plan for the other window covering everything not yet
  tested for real. Commit it and push it with the work. Tell the owner you updated it.
