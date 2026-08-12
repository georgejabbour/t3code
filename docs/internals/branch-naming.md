# Branch naming

How T3 Code names the branch for a thread, and how the thread keeps track of
that branch afterwards.

Terms used below:

- **Worktree** — a second working folder for the same git repository, with its
  own checked-out branch. T3 Code makes one per thread when a thread starts in
  worktree mode.
- **PR** — pull request.
- **TTL** — time to live, the life of a cache entry.

## Naming happens in two steps

1. **The client names a placeholder.** Before the thread starts, the client
   builds `<prefix>/<8 hex characters>`, for example `t3code/9f21ab04`. See
   `buildTemporaryWorktreeBranchName` in `packages/shared/src/git.ts`. The
   server creates the worktree with that branch.
2. **The first turn names the real branch.** A model writes a short slug from
   the task text, and the server renames the branch to `<prefix>/<slug>`. See
   `maybeGenerateAndRenameWorktreeBranchForFirstTurn` in
   `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`.

The rename happens once, on the first turn only. A branch that is not a
placeholder is never renamed.

## The prefix comes from the project

The prefix is `t3code` unless the repository sets one:

```jsonc
// t3.json, at the repository root
{
  "branchPrefix": "george",
}
```

That produces `george/9f21ab04`, then `george/fix-login`. A repository with its
own branch convention keeps it, and continuous-integration rules that key on a
branch prefix keep working.

T3 Code lowercases the value. The prefix may hold several segments, as in
`team/george`. It may not start or end with `/`, hold an empty segment, or hold
whitespace. `packages/contracts/src/t3ProjectFile.ts` checks the shape, and
`resolveWorktreeBranchPrefix` in `packages/shared/src/git.ts` applies the
default when a project sets nothing.

### Every placeholder test needs the prefix

`isTemporaryWorktreeBranch` answers "is this branch still the placeholder?" and
it can only answer with the project's prefix in hand. A caller that omits the
prefix tests against `t3code`.

This matters more than it looks. Give a configured project the wrong prefix and
two things break at once:

- The first turn never renames the branch, because `george/9f21ab04` does not
  look like a placeholder.
- The drift follower below adopts the placeholder as the thread's real branch,
  racing the rename.

The server reads the prefix from the worktree's `t3.json` through
`resolveBranchPrefixForWorkspace` in `apps/server/src/project/BranchPrefix.ts`.

## The worktree folder is named after the thread

The folder is `<worktrees dir>/<repository>/thread-<thread id>`. It is **not**
named after the branch, because the branch it starts with is a placeholder that
step 2 renames. A folder named after that placeholder would disagree with the
branch for the life of the worktree, and it reads as a branch that no longer
exists.

A worktree a user creates for an existing branch still takes its name from that
branch, because that name stays true. See `createWorktree` in
`apps/server/src/vcs/GitVcsDriverCore.ts`.

## The client only shows a PR when the two branches agree

The client attributes a pull request to a thread only while the thread's
**recorded** branch equals the branch **checked out** in its worktree. See
`resolveBranchToolbarPrBranch` in `apps/web/src/components/BranchToolbar.logic.ts`.

This is deliberate, and it dates from issue #4460. A `git checkout` run inside a
worktree by an agent or by the user bypasses T3 Code's own commands, so the
thread's recorded branch goes stale. Showing a pull request against a stale
branch would attribute one thread's pull request to another.

The cost is that any gap between the two branches hides the badge. Two
mechanisms close that gap.

## Following a branch that drifted

`followWorktreeBranchDrift` in
`apps/server/src/orchestration/Layers/CheckpointReactor.ts` adopts the
checked-out branch as the thread's branch. It runs on two signals:

1. **A status change.** The status poll reports the checked-out branch about
   once a second, and the reactor follows the branch as soon as it changes.
2. **A turn completing.** The original signal, kept as a backstop.

It declines in three cases, each on purpose:

- The checked-out branch is a placeholder. The first-turn rename is still in
  flight, and following it would race that rename.
- The folder belongs to more than one thread. Strict matching is the point for
  a shared folder.
- The recorded branch is itself a placeholder.

The update is a compare-and-swap: it carries the branch it expects to replace,
so a stale update is dropped if the recorded branch moved in the meantime.

## Pull request lookups are cached for two minutes

A pull request lookup calls the hosting provider's command line tool, so it runs
on a slower cadence than the rest of the status. Constants live in
`apps/server/src/git/GitManager.ts`:

| Constant                     | Value                |
| ---------------------------- | -------------------- |
| `STATUS_RESULT_CACHE_TTL`    | 1 second             |
| `PR_LOOKUP_CACHE_TTL`        | 2 minutes            |
| `PR_LOOKUP_FAILURE_BASE_TTL` | 20 seconds, doubling |
| `PR_LOOKUP_FAILURE_MAX_TTL`  | 15 minutes           |

A git action run inside T3 Code bypasses the cache at once, because it bumps a
per-folder epoch that forms part of the cache key.

**A pull request opened outside T3 Code does not bump that epoch.** Open one with
`gh pr create` in a terminal and the badge can take up to two minutes to appear.
Three things ask again straight away:

- The refresh button in the git actions group of the branch toolbar.
- Opening the git actions menu.
- Returning focus to the T3 Code window.

## Where to look first

| Question                              | File                                             |
| ------------------------------------- | ------------------------------------------------ |
| How is the placeholder built?         | `packages/shared/src/git.ts`                     |
| How is the prefix configured?         | `packages/contracts/src/t3ProjectFile.ts`        |
| Who renames the branch?               | `orchestration/Layers/ProviderCommandReactor.ts` |
| Who follows a drifted checkout?       | `orchestration/Layers/CheckpointReactor.ts`      |
| Why is the pull request badge hidden? | `apps/web/src/components/BranchToolbar.logic.ts` |
| Why is the pull request badge late?   | `apps/server/src/git/GitManager.ts`              |
