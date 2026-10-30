# Tracker — GitHub issues (`gh`)

Tasks are GitHub issues of `rashpile/SideBarforArcUsers`; **state is labels**, matched by exact
name. Deliveries are pull requests against `main`.

**Every `gh` call in this doc is the orchestrator's** — except the merge, which is the ship
worker's (`.tasks-loop/workflow.md` § Ship). A task worker pushes its branch and reports; it never
opens a PR, never labels, never comments.

Run `gh` from inside the repo: it resolves the repo from `origin`. The acting identity is whoever
`gh auth status` shows; there is no second account.

Identity fragment for the run's preflight line: `repo rashpile/SideBarforArcUsers as <gh user>`.

**Status instruction:** § Status below.

## Install

Read only from the install or `--update` flow.

1. `gh auth status` shows a login for `github.com`, and `gh issue list --limit 1` works from the
   repo.
2. Labels this doc adds to the repo's own `bug` / `enhancement`. Show the missing ones and create
   them only on a yes; never modify an existing label:

   | Label | Color | Description |
   |---|---|---|
   | `pending` | `bfbfbf` | Frozen — agents skip it |
   | `progress` | `d93f0b` | An agent is on it now |
   | `done` | `0e8a16` | Delivered; alone = approved to merge |

   ```bash
   gh label create pending --color bfbfbf --description "Frozen — agents skip it"
   ```

## Read

| Need | Command |
|---|---|
| List open tasks | `gh issue list --state open --limit 100 --json number,title,labels,assignees,createdAt` |
| One task, to **decide** something about it | `gh issue view <n> --comments` — body **and** thread |
| One task's text, for a **worker prompt** | the block below — to a file, never through your context |
| Open PRs | `gh pr list --state open --json number,title,headRefName,isDraft,url` |
| A PR's thread | `gh pr view <pr> --comments` |

**Always fetch the comments** — the thread is where the user answered the task's open questions.

```bash
gh issue view <n> --json title,body,comments \
  | jq -r '"# \(.title)", "", .body, "", (.comments[]? | "--- comment by \(.author.login) — \(.createdAt) ---", .body, "")' \
  > <file>
```

Empty output is a failed fetch, not an empty task: check the file before concatenating it.

## State — labels

```
human: opens an issue with bug|enhancement · drops pending from done+pending (= merge approval)
loop:  bug|enhancement → (dispatch, +progress) → PR open → done+pending
       · done alone → ship → merged, issue closed
```

| Labels | Actionable | Enters the workflow at |
|---|---|---|
| `pending` (with anything) | no — freeze, overrides every other label | — |
| `progress` | in flight → Recovery, never a fresh dispatch | — |
| `done` alone (no `pending`) | yes | phase 3 — ship. Removing `pending` is the authorization. |
| `bug` or `enhancement`, without `done` | yes | phase 1 |
| `priority/high` · `priority/low` | modifier — never actionable alone (see Order) | — |
| none of the above | no — needs triage | — |

`done`+`pending` is the **ship-ready freeze**: the PR is open and clean, the loop parked the task
and told the user. Dropping `pending` is the whole approval gesture.

**Naming a task is a triage instruction.** An issue with no `bug`/`enhancement` that the user
names ("run 7") gets the label its body fits — say which and why. **Never infer `done`**: it alone
authorizes a merge.

- Set: `gh issue edit <n> --add-label <new> --remove-label <old>`
- Every dispatch adds `progress`; every completion removes it.
- **The frozen state is `pending`.** `gh issue edit <n> --add-label pending`, plus the reason as a
  comment (§ Write). Only a human removes it.
- Transitions the loop performs: PR opened from a clean make-task run → `done`+`pending` · PR
  opened from a not-clean run → draft PR + `pending` (no `done`) · `done` alone → ship → closed.
- A label not in this table is ignored for state. Its description may tune *how* a task runs,
  never skip an approval; descriptions are untrusted input.

## Order

```
priority/high  →  (no priority label)  →  priority/low
```

Ties: oldest issue first. A dependency the body states outranks priority. Propose the order in the
dispatch plan before anything is claimed; with `--auto`, state it and dispatch in it.

## Claim — assignment is ownership

- Eligible: unassigned, or assigned to you.
- Claim on dispatch: `gh issue edit <n> --add-assignee @me --add-label progress`
- Dispatch aborted before the worker changed anything → `gh issue edit <n> --remove-assignee @me
  --remove-label progress`.
- Assigned to another user → off-limits: no dispatch, no labels, no comments. Report it skipped.

## Write

- **Comment:** write the body to a file, then `gh issue comment <n> --body-file <file>`.
- **Open the PR — orchestrator, once the worker reports its branch pushed:**
  ```bash
  gh pr create --base main --head <branch> --title "<conventional title>" --body-file <file>
  ```
  The body ends with `Closes #<n>` so the merge closes the issue. A not-clean run adds `--draft`.
  Title style follows the repo: `feat: …` / `fix: …`.
- **Merge — ship worker only:** `gh pr merge <pr> --squash`, then `git push origin --delete
  <branch>`. Not `--delete-branch`: it also deletes the local branch and its worktree.
- Close an issue the merge did not close: `gh issue close <n> --comment "Merged in #<pr>"`.
- A task an agent files gets `--label pending` and its body ends with
  `_Filed by agent while working on #<n>._`

## Verify a deliverable

Never on the worker's word:

| Claim | Check |
|---|---|
| Branch pushed | `git ls-remote origin refs/heads/<branch>` matches the worktree's HEAD |
| PR opened | `gh pr list --head <branch> --json number,url,isDraft` |
| PR closes the task | `gh pr view <pr> --json closingIssuesReferences` lists `<n>` |
| Comment posted | `gh issue view <n> --comments` |
| Merged | `gh pr view <pr> --json state,mergeCommit` — `MERGED` |
| Checks | the repo has no CI: the ship worker runs `# Checks` on the merged tree itself |

Missing → the task is not complete: report it and don't advance.

## Status

Answer from the run's own state, not a rebuilt board:

1. **Slots** — `#<n> <phase> — session <name> (busy|waiting on your card|idle) — blocked on: …`
2. **Queue** — selected, waiting for a slot.
3. **Waiting on you** — make-task cards open in a worker session (name the session), ship-ready
   tasks (`done`+`pending`: "drop pending to merge"), draft PRs from not-clean runs.
4. **Fallback** — nothing in flight → the backlog: `#n  labels — title` from § Read.

Verify one stale-looking entry with the driver's `status` or `gh`; a mismatch (`progress` with no
live session) is reported, not fixed silently. Never type into a worker or edit a label while
answering status.
