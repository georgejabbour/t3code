# Branch naming

The repository can set `branchPrefix` in `t3.json` to keep a convention across environments.
This value overrides the resolved project prefix.
Native naming mode and instructions still control the final generated name.
An empty project prefix produces an unprefixed final name in static mode.
Temporary branches use `t3` when the selected prefix is empty.

[Thread launch](../../apps/server/src/orchestration-v2/ThreadLaunchService.ts) creates temporary branches on the server.
Mobile and web clients can omit the branch when they request a new worktree.
The server starts setup before name generation finishes.
Generation or rename failure leaves the temporary branch available.

## Stable worktree paths

The directory uses `thread-<thread id>` because the first generated branch name can change.
Renaming the branch does not move the directory or change the saved worktree path.
An explicit ordinary branch keeps its name and the native directory convention.

Git stores branches as paths.
An existing `team` branch blocks `team/george/<token>`, even when `team/george` does not exist.
Launch checks each parent path and flattens a blocked temporary name to `team-george-<token>`.
The shared matcher recognizes this fallback and native or legacy temporary forms.
Callers must still supply the resolved prefix to recognize configured temporary names.

## Branch ownership

[Branch tracking](../../apps/server/src/orchestration-v2/WorktreeBranchDrift.ts) follows changes in an owned checkout.
It ignores temporary branches while first-turn naming runs.
It also ignores checkouts that more than one active thread owns.
The metadata update checks the expected branch and path to reject a concurrent change.

The web draft tracker uses the same naming options from its selected environment and project.
The server handles tracking for saved threads, including changes that occur without an open client.

The web client shows a pull request only when the recorded branch matches the checked-out branch.
An external checkout can therefore hide the badge until branch tracking updates the thread.
This guard prevents the client from showing a pull request for a different branch.
