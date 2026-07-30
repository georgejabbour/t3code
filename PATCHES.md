# Fork patches

This fork carries a small patch layer on top of `pingdotgg/t3code`. Everything
here exists to be deleted: the day upstream ships an equivalent, drop the patch
and reinstall the published `t3`.

## Rules

1. One branch, `worktree-remove-hook`, holding only our commits, **rebased** onto
   upstream. Never merge upstream in — merges compound and turn every later
   conflict into archaeology.
2. Patches stay additive. New files never conflict, so real logic lives in new
   files and edits to existing files stay a few lines each.
3. `apps/server/src/ws.ts` is the risky insertion point: a large, frequently
   edited RPC dispatch file. Keep our edit there to a single call.
4. Migrations are one-way. Back up `~/.t3/userdata/state.sqlite` before every
   version jump. `t3code-fork-update` does this and refuses to install a build
   older than the live database.
5. If the patch ever grows past a few files, stop and reconsider rather than
   push through.

## Staying current

```sh
t3code-fork-update              # rebase onto origin/main, typecheck, test
t3code-fork-update --install    # the above, then build and install globally
```

The script lives at `~/.local/bin/t3code-fork-update`, outside this repo, so it
never widens the diff against upstream.

## Patch 1 — `runOnWorktreeRemove`

**Commit:** `feat(server): run a t3.json script before removing a worktree`

**Why.** T3 Code deletes a worktree with no way to run cleanup first, so every
Docker stack, named volume, built image and dev-server process keyed to that
path outlives it with nothing left to reference it. Four orphan stacks — 12
named volumes and 3 containers — accumulated over eight days on one machine
before anyone noticed. Conductor solves this with `[scripts] archive` in
`.conductor/settings.toml`. T3 Code has `runOnWorktreeCreate` and no counterpart.

**What.** A `t3.json` script flagged `runOnWorktreeRemove` runs to completion
before `vcs.removeWorktree` deletes the worktree. A non-zero exit or a timeout
cancels the removal and returns `WorktreeArchiveScriptError` with the script
output; the client shows it and offers to remove the worktree anyway, retrying
with `skipArchiveScript`. Cleanup failure never traps a workspace and never
silently leaks one.

**Design notes.**

- Scripts are read from the checked-in `t3.json` via the existing
  `T3ProjectFileLoader`, not from imported project scripts, so editing that file
  takes effect on the next removal with no re-import. This is the one deliberate
  divergence from how `runOnWorktreeCreate` resolves its script.
- 10 minute timeout, not `ProcessRunner`'s 60 second default: compose teardown
  plus image and build-cache pruning routinely exceeds a minute.
- Two `Layer` pipes sat at TypeScript's 20-argument overload limit, so the new
  layer and its test mock are merged into an existing entry rather than appended.
  A 21st argument fails to typecheck with a misleading error.

**Files.** New: `apps/server/src/project/WorktreeArchiveScriptRunner.ts` and its
test. Edited: `packages/contracts/src/{t3ProjectFile,git,rpc}.ts`,
`packages/shared/src/projectScripts.ts`, `apps/server/src/{server,ws,server.test}.ts`,
`apps/web/src/hooks/useThreadActions.ts`.

**Upstream status.** Not filed. `CONTRIBUTING.md` says contributions are not
being accepted and that non-trivial changes should start as an issue. If it is
ever filed and merged, delete this patch.
