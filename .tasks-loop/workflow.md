# Workflow — make-task

How **one task is worked** in this project. The tracker doc (`.tasks-loop/github.md`) owns task
state and the phase a task enters at; this doc owns the phases.

**No sub-docs.** Brainstorm, plan, plan review, execution, the revmux review-fix loop and finalize
all happen inside one `/make-task` run in the worker's session — that skill is the phase-1
playbook. The bundled `review.md` and `exec.md` are not read.

## Phases

| # | Phase | Who runs it | Done when |
|---|---|---|---|
| 1 | Make | task worker, running `/make-task` | make-task reported its final status (`clean` or `not clean`) |
| 2 | Push | task worker pushes; **the orchestrator opens the PR** | the PR is open and verified |
| 3 | Ship | ship worker | squash-merged, checks green on `main`, issue closed |

**This column is the dispatch rule.** One task worker runs 1 and 2 in one session. Phase 3 is a
separate ship worker, dispatched only for a task the tracker enters at phase 3.

**The project decides which phases it runs** — a phase with no heading in the config's `# Workflow`
is skipped. A heading's body is the project's detail for that phase and may set `model:` and
`permission-mode:` on lines of their own.

## What each phase means

**1. Make** — invoke the `make-task` skill with the task text. make-task asks the user **only**
during brainstorm and at the leftovers card, through the standard `AskUserQuestion` in the
worker's own session, not the floating agterm cards (`MT_NO_CARDS=1` makes `mt` skip them).
Everything else runs without a human.

- The worker runs in a linked worktree, so make-task asks no worktree question and stays in place:
  its commits land on the task branch `issue/<n>-<slug>`.
- make-task never pushes. Its finalizer rebases onto `origin/main` and squashes.
- **A worker waiting on a make-task question is waiting on a human, not stalled.** `status` shows a
  `waiting` request with its `prompt` and `options`. Do not count those re-arms toward the stall
  clock; tell the user which session has a question open and what it asks, and keep waiting. A
  worker that still opens a floating card (it forgot `MT_NO_CARDS=1`) shows `waiting` without a
  request; `read --tail` once to tell the two apart.

**2. Push** — after make-task's final report, the worker pushes the branch
(`git push -u origin issue/<n>-<slug>`; never force, never `main`) and ends with:

```
DONE pushed <branch> status=<clean|not clean>
<make-task's final summary: what changed, decisions/deviations, open findings>
```

The worker never opens the PR. The orchestrator then, per the tracker doc's § Write: opens the PR
(draft when `not clean`), verifies it, posts make-task's summary as a comment on the issue, and
sets the state — `clean` → `done`+`pending`; `not clean` → `pending` with the open findings in the
comment. Either way the task leaves the run: close the worker, drop the worktree, keep the branch.

**3. Ship** — at the end of a run, collect every task the tracker enters at phase 3 (`done`
alone — the user dropped `pending`) and dispatch **one** ship worker (`ship-<n>[-<n>…]`, main
checkout, no slot of its own). Its brief, per PR in order:

1. `git fetch origin`; check the PR is mergeable. Mechanical conflict → merge `origin/main` into
   the branch in a worktree, run `# Checks`, push (never force). Semantic conflict → stop, report
   it; that task is closed as BLOCKED.
2. Run `# Checks` on the branch rebased onto current `main` (there is no CI) — red → stop, report.
3. `gh pr merge <pr> --squash`, then `git push origin --delete <branch>`. Never `--delete-branch`:
   it also deletes the local branch and its worktree, which `--keep` leaves for the user.

After all merges: `git checkout main && git pull --ff-only` in the main checkout, run `# Checks`
once on `main`, confirm each issue closed (close it with a comment if not), then remove each local
worktree and branch — `git branch -D` only after checking the branch's own files are identical on
`main` (a squash-merge leaves the branch unmerged by ancestry). Report what merged.

**The merges are the ship worker's.** The orchestrator never merges; a refused spawn means nothing
merged — report it and leave those tasks at `done`.

**The ship worker runs with `permission-mode: acceptEdits`** (config § 3. Ship), not `auto`: auto
mode's classifier denies `gh pr merge` as "Merge Without Review" and the worker is stuck. In
`acceptEdits` the merge, `git push`, `git pull` and `gh issue` calls raise an approval `waiting`
instead, and the orchestrator answers it (`answer --to <request id>`), as § Supervise says. The
approval for a PR's merge is already given — the user dropped `pending`, or `--full-auto` did —
so approve the `gh pr merge <pr> --squash` and the `git push origin --delete <branch>` of that
PR's own branch, for exactly the PRs in the brief. Any
other destructive request (force-push, `rm -rf`, `git reset --hard`, deleting a branch other than
the merged one) goes to the user, as always.

No deploy: the extension is not published. The loop says "deploy not configured" in the summary.

## Workspace

One worktree per task, from the main checkout:

```bash
git fetch origin
git worktree add .worktrees/<n> -b issue/<n>-<slug> origin/main
```

`.revmux/profile.md` is committed, so the worktree has the review profile once it is on
`origin/main`.

The worker runs `npm ci` in the worktree before anything else (`node_modules/` is per checkout).
`.worktrees/` is gitignored.

## Worker prompt

Session `make-<slug>-<n>`. Written to a file and sent as a one-line pointer (SKILL.md § Every turn
to a worker is a one-line pointer):

```
Work on GitHub issue #<n>: "<title>".

<the task body and comment thread, from the tracker's prompt-text read. Where they conflict,
the newest comment from the user wins.>

Rules:
- You are in <worktree path>, on branch issue/<n>-<slug>. Follow the project's CLAUDE.md.
- First run `npm ci`. Then invoke the make-task skill with the task above as its text.
  It asks the user only via `AskUserQuestion` in this session; do not ask anything else.
- Run every `mt` call with `MT_NO_CARDS=1` as a prefix
  (`MT_NO_CARDS=1 uv run -q --script <skill dir>/scripts/mt …`), so make-task asks through
  `AskUserQuestion` and never opens floating agterm cards.
- Phase details from the config: <## 1. Make body> <## 2. Push body>
- Checks that must pass: <# Checks>. Notes: <# Notes>
- When make-task has finished, push the branch (never force, never main) and end with the
  DONE line from phase 2. Never open a PR, never label or comment on GitHub.
- If you file a new issue, label it `pending` and end its body with
  "_Filed by agent while working on #<n>._"
- Anything destructive (rm -rf outside this worktree, git reset --hard on others' work,
  force-push): stop and report WAITING with the reason.
```

## Gates and the automatic modes

| Gate | Interactive / `--auto` | `--full-auto` |
|---|---|---|
| make-task's brainstorm and leftovers questions (`AskUserQuestion`) | the user answers in the worker's session | **unchanged** — make-task asks the user directly; the loop cannot answer its questions |
| merge approval (`done`+`pending` → `done`) | the user drops `pending` | the run drops it itself for a **clean** run, records it on the issue, and ships |
| a `not clean` run | frozen with `pending`, draft PR | same — a not-clean result is never auto-approved |

`--auto` changes selection only. `--full-auto` supplies the merge approval and nothing else; the
checks still have to pass, and a semantic merge conflict closes that task.
