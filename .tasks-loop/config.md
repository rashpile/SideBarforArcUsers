---
task-tracker: .tasks-loop/github.md
task-workflow: .tasks-loop/workflow.md
agent-driver: js-claude-agterm
agent-driver-cmd: ~/.config/agent-driver/js-claude-agterm/claude-agterm
slots: 2
orchestrator-model: opus:medium
skill-rev: 557ba17
driver-rev: c9e2c27
---

# Workflow

## 1. Make
Run `/make-task` on the issue text. Plans go to `docs/plans/YYYYMMDD-<name>.md` and move to
`docs/plans/completed/` when done (make-task does both). Update `README.md`, `docs/changelog.md`,
`docs/state-reference.md` and `src/data/changelog.ts` as CLAUDE.md § Documentation says.

## 2. Push
Push `issue/<n>-<slug>` to `origin`. PR against `main`, conventional title (`feat: …` / `fix: …`),
body ends with `Closes #<n>`.

## 3. Ship
permission-mode: acceptEdits

Squash-merge without `--delete-branch` (it also deletes the local branch and its worktree, which
`--keep` must leave), then delete the remote branch with `git push origin --delete <branch>`. No deploy: the extension is not published to the Chrome Web
Store.

# Checks

`make lint && make test && make build`

# Notes

- Worktrees live in `.worktrees/<n>` (gitignored). Each needs its own `npm ci` before checks run.
- `.revmux/profile.md` is committed; the rest of `.revmux/` (run archives) is gitignored.
- No CI on GitHub: the checks above are the only gate, run locally.
- Invariants in CLAUDE.md (archive folder, bookmark roots, tab ids, one writer per key) are what
  make-task's revmux review is calibrated against — see `.revmux/profile.md`.
