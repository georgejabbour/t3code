# Fork patches

This fork keeps a small patch layer on top of `pingdotgg/t3code`. Each patch here
exists to be deleted. On the day upstream ships the same function, delete the
patch and install the published `t3` again.

## Rules

1. Keep one branch, `hermes-fork-patches`. It holds our commits only, and it is
   **rebased** onto upstream. Never merge upstream into it. Merges add up, and
   they make every later conflict difficult to read.
2. `hermes-fork-patches` is the branch this fork serves. The updater pushes it to
   the `fork` remote, `git@github.com:georgejabbour/t3code.git`, after an install
   succeeds. This branch had the name `worktree-remove-hook` before 2026-08-05. A
   remote branch with the old name can remain until you delete it.
3. Keep the patches additive. A new file never conflicts. Put the real logic in
   new files, and keep each edit to an upstream file at a few lines.
4. `apps/server/src/ws.ts` is the dangerous insertion point. It is a large remote
   procedure call (RPC) dispatch file, and upstream edits it often. Keep our edit
   there to one call.
5. Migrations run in one direction only. Make a copy of
   `~/.t3/userdata/state.sqlite` before every version change. `t3code-fork-update`
   makes this copy. It also refuses to install a build that is older than the live
   database.
6. If the patch layer becomes larger than a few files, stop and think again. Do
   not continue.

## Staying current

```sh
t3code-fork-update --check           # rebase onto the published nightly, typecheck, verify markers
t3code-fork-update --install         # the above, then build and install globally
t3code-fork-update --check --test    # the check, and also run the maintained test set
t3code-fork-update --install --test  # the install, and also run the maintained test set
```

Tests do not run by default. Add `--test` to run the maintained test set.

The script is at `~/.local/bin/t3code-fork-update`, outside this repository, so it
never makes the difference against upstream larger.

A clean rebase does not prove the patch still works. This fork's tests copy
upstream types and upstream test data. Upstream keeps adding to both, on lines
this fork never edits. Git therefore reports no conflict, and the typecheck or the
tests fail straight after. Four cases have appeared so far. The first two appeared
while verifying `0.0.34-nightly.20260810.1061`:

1. Upstream added two required fields to `ProcessRunOutput`, so Patch 1's test
   helper had to name them too.
2. Upstream added a test that starts a session in `/tmp/project`, one day after
   this fork made `startSession` refuse a folder that is not on disk. Tests in
   `apps/server/src/provider/Layers/ProviderService.test.ts` must name a real
   folder through the `sessionCwd` helper there. Any new upstream test in that
   file needs the same helper.

3. Upstream's `packages/shared/src/t3ProjectFile.test.ts` lists every script
   field by name. Patch 1 adds `runOnWorktreeRemove` to that schema, so the
   list in that test needs the new name too. Any upstream test that enumerates
   a schema this fork extends breaks the same way.

4. `0.0.34-nightly.20260820.1146` added
   `apps/server/integration/orphanedProviderSessionStartup.integration.test.ts`.
   That test builds the startup dependencies by hand instead of taking the real
   server layer. This fork makes `serverRuntimeStartup.ts` ask for one more
   service, `ArchivedThreadReaper`, so the hand-built set has to name it too. The
   test now supplies the same do-nothing stub it already supplies for
   `ProviderSessionReaper`. Any upstream test that assembles startup dependencies
   by hand breaks the same way. The real layer stays correct: `server.ts` provides
   `ArchivedThreadReaperLive` through `ProviderRuntimeLayerLive`.

The second case was broken from 8 August 2026 and nobody saw it. By default the
updater runs no tests, and even with `--test` it runs a few files only. The third
case was broken for as long, and found on 11 August 2026 by running the whole
suite. The type check caught the fourth case on 20 August 2026, before any test
ran. Run the tests of every file this fork edits before an install, not the few
that `--test` names. Better, run `pnpm test` and read the result.

After an install, the script reads the built output and looks for one text marker
from each patch. A missing marker means the build lost that patch, and the script
stops with an error.

| Patch | Marker                                     | File that holds the marker                  |
| ----- | ------------------------------------------ | ------------------------------------------- |
| 1     | `runOnWorktreeRemove`                      | `dist/bin.mjs`, the server bundle           |
| 2     | `execCommand("copy")`                      | `dist/client/assets`, the web client bundle |
| 3     | `refused-foreign-worktree`                 | `dist/bin.mjs`, the server bundle           |
| 5     | `IgnoredWorkspaceEntries.listIgnoredPaths` | `dist/bin.mjs`, the server bundle           |
| 5     | `t3code:file-explorer-show-ignored`        | `dist/client/assets`, the web client bundle |
| 6     | `data-file-tree-initial-expansion`         | `dist/client/assets`, the web client bundle |
| 7     | `A pre-push hook may have rejected it.`    | `dist/bin.mjs`, the server bundle           |
| 8     | `First segment of the branch name`         | `dist/bin.mjs`, the server bundle           |
| 8     | `Refresh git and pull request status`      | `dist/client/assets`, the web client bundle |
| 9     | `Rebuilt this thread's worktree`           | `dist/bin.mjs`, the server bundle           |
| 10    | `providerSessionIdleTimeout`               | `dist/bin.mjs`, the server bundle           |
| 11    | `t3/provider/SubscriptionUsageService`     | `dist/bin.mjs`, the server bundle           |
| 11    | `Add another subscription`                 | `dist/client/assets`, the web client bundle |
| 12    | `subscription-usage-history.json`          | `dist/bin.mjs`, the server bundle           |
| 12    | `ran out in`                               | `dist/client/assets`, the web client bundle |
| 13    | `discoverClaudeProjectCommands`            | `dist/bin.mjs`, the server bundle           |
| 13    | `provider.getProjectPrompts`               | `dist/client/assets`, the web client bundle |
| 14    | `no setting was saved`                     | `dist/bin.mjs`, the server bundle           |

Patch 2's marker is the whole call, `execCommand("copy")`, not the method name on
its own. Upstream already ships a syntax-highlighting grammar chunk that contains
the word `execCommand`, so the shorter marker would pass on a build with no patch.

Patch 5 needs two markers, because it changes both bundles. Either one missing
means the build lost half the patch, and half of a patch does nothing. Patch 8
needs two for the same reason.

Choose a marker upstream is unlikely to write for its own reasons. `includeIgnored`
was rejected for Patch 5 for that reason, and the operation string and the storage
key were chosen instead. A bundler renames variables, so a marker must be a string
literal, a storage key, or an attribute name.

## Patch 1 — `runOnWorktreeRemove`

**Commit:** `feat(server): run a t3.json script before removing a worktree`

**Why.** T3 Code deletes a worktree, and it gives you no way to run a cleanup step
first. Every Docker stack, named volume, built image and development server
process that points at that path stays behind. Nothing refers to them any more. On
one machine, four orphan stacks collected over eight days before a person saw
them. Those stacks held 12 named volumes and 3 containers. Conductor solves this
with `[scripts] archive` in `.conductor/settings.toml`. T3 Code has
`runOnWorktreeCreate` and no equivalent for removal.

**What.** A `t3.json` script with the `runOnWorktreeRemove` flag runs to
completion before `vcs.removeWorktree` deletes the worktree. A non-zero exit code
or a timeout cancels the removal. The server then returns
`WorktreeArchiveScriptError` with the script output. The client shows that output
and offers to remove the worktree anyway. The retry sends `skipArchiveScript`. A
cleanup failure never traps a workspace, and it never lets one leak in silence.

**Design notes.**

- The runner reads the scripts from the `t3.json` file in the checkout, through
  the existing `T3ProjectFileLoader`. It does not read the imported project
  scripts. An edit to that file therefore applies at the next removal, with no
  re-import. This is the one difference from the way `runOnWorktreeCreate`
  resolves its script, and it is deliberate.
- The **worktree's** `t3.json` wins. The project root is the fallback, and it
  applies only when the worktree has no `t3.json`. The worktree is the checkout
  that the server tears down, and the script that runs belongs to it too. The
  command is relative, and it runs with `cwd` set to the worktree. The
  configuration and the script therefore stay on one branch. If the runner read
  the project root only, a branch could ship an `archive.sh` that its own
  `t3.json` entry could not enable.
- The timeout is 10 minutes, not the 60 second default of `ProcessRunner`. A
  compose teardown, plus a prune of images and of the build cache, regularly needs
  more than one minute.
- Two `Layer` pipes were already at the 20-argument overload limit of TypeScript.
  The new layer and its test mock therefore go into an existing entry. They are
  not appended. A 21st argument fails the typecheck, and the error message does
  not say why.
- The test builds a complete `ProcessRunOutput` value, so it copies that upstream
  interface field for field. Upstream adds fields to the interface from time to
  time. It added `stdoutInvalidUtf8` and `stderrInvalidUtf8` in
  `0.0.34-nightly.20260810.1061`. Each addition needs the same field in the
  `processOutput` helper at the top of the test. The rebase stays clean, so this
  arrives as a typecheck error and never as a conflict.

**Files.** New: `apps/server/src/project/WorktreeArchiveScriptRunner.ts` and its
test. Edited: `packages/contracts/src/{t3ProjectFile,git,rpc}.ts`,
`packages/shared/src/projectScripts.ts`, `apps/server/src/{server,ws,server.test}.ts`,
`apps/web/src/hooks/useThreadActions.ts`.

**Upstream status.** Not filed. `CONTRIBUTING.md` says that the project does not
accept contributions, and that a non-trivial change must start as an issue. If
someone files this patch and upstream merges it, delete the patch.

## Patch 2 — clipboard copy on a plain-HTTP address

**Commit:** `fix(web): copy from the browser on a plain-HTTP address`

**Why.** A browser creates `navigator.clipboard`, the modern clipboard interface,
in a "secure context" only. An address counts as secure when it starts with
`https://`, or when it is `http://localhost`. A plain-HTTP address does not count.
A LAN IP address and a Tailscale MagicDNS name are both plain-HTTP addresses.
Every copy action in the web application used that interface, so every one of them
failed at such an address. Cmd+C in the terminal printed "Clipboard API is
unavailable while copying terminal selection." Two other copy actions failed and
showed no message at all. This server runs on a tailnet address, so the fault hit
every copy made from another device.

**What.** The shared write helper, `writeTextToClipboard`, now falls back to
`document.execCommand("copy")`. That older command needs no secure context. Seven
copy actions called the clipboard interface directly and carried the same fault.
They now call the shared helper. The Connections settings screen keeps its copy
buttons visible on a plain-HTTP address, because the buttons work there now. Paste
needs no change. The terminal reads a native `paste` event, which works with no
secure context.

**Design notes.**

- The fallback runs with no `await` in front of it. The browser lets
  `document.execCommand("copy")` write only while the key press or the click that
  started the call is still active. One `await` before that point ends the user
  gesture, and the copy is lost.
- The fallback saves the keyboard focus and the page text selection first. It puts
  both back in a `finally` block. The terminal holds its keyboard on a hidden
  textarea, so a lost focus would stop the terminal from accepting keys.
- The temporary element is a `textarea`, not a `contenteditable` div. A textarea
  holds the string byte for byte. A div lets the browser normalize the white
  space, which would damage a terminal selection with its newlines and its leading
  spaces.
- iOS Safari ignores `select()` on a read-only textarea. The helper detects an
  iOS-like browser and uses a document range plus `setSelectionRange` there.
  iPadOS 13 and later report "Macintosh", so the test also reads
  `navigator.maxTouchPoints`.
- `isClipboardWriteSupported()` reports whether either path can write. The
  Connections settings screen calls it to decide whether to show the copy buttons
  at all.
- In a secure context the helper still calls `navigator.clipboard.writeText`
  first. It falls back only after that call rejects. Chromium keeps the user
  gesture across a promise turn, so the fallback rescues a refused write there.
  WebKit and Gecko tie the gesture to the call stack and can refuse. In that case
  the helper reports the original failure.

**Files.** New: `apps/web/src/hooks/useCopyToClipboard.test.ts`. Edited:
`apps/web/src/hooks/useCopyToClipboard.ts`,
`apps/web/src/cloud/useCloudLinkController.ts`,
`apps/web/src/components/{ChatMarkdown,ChatView}.tsx`,
`apps/web/src/components/cloud/CloudEnvironmentConnectList.tsx`,
`apps/web/src/components/preview/PreviewView.tsx`,
`apps/web/src/components/settings/ConnectionsSettings.tsx`,
`docs/user/remote-access.md`.

**Upstream status.** Not filed, for the reason given in Patch 1. Upstream serves
the web application over plain HTTP through `t3 serve --host`, so upstream carries
this fault too.

## Patch 3 — the archived-thread sweep only removes folders T3 made

**Commit:** `fix(server): stop archived sweeps removing foreign worktrees`

**Why.** This fork adds a sweep that deletes archived threads once a day and
removes the worktree each one owns. See the commit `feat(server): delete archived
threads once a day, behind a setting`. The sweep trusted the path stored on the
thread. A thread stores whatever path its worktree had, and that path can name any
folder on the disk, including one T3 never created.

One thread on George's machine recorded the maintained fork checkout itself, at
`~/Development/worktrees/t3code/worktree-remove-hook`. The sweep therefore ran
`git worktree remove` against the folder that holds this patch layer. That
checkout is large, the command passed its time limit, and the run was stopped part
way through. Git had already begun deleting, so each attempt left 140 tracked
files gone, among them `pnpm-lock.yaml`, `tsconfig.base.json` and this file. The
removal never finished, so the thread stayed archived and the next sweep tried
again. It happened on 7 August 2026 and again on 8 August 2026.

**What.** The sweep now decides who owns a folder before it reads or runs
anything inside it. A worktree counts as T3's only when it sits inside
`worktreesDir`, the folder the server derives from its base directory and creates
its worktrees in. Anything else is refused, with a warning naming the thread, the
path and the managed folder.

A refusal returns the same "not removed" answer a failed teardown returns, so the
thread keeps its record of the path and the sweep can try again later. Nothing in
the folder is touched, so a refusal cannot damage files.

**Design notes.**

- The managed folder comes from `ServerConfig.worktreesDir`, the value the server
  already derives and already creates. It is not spelled out a second time here.
- Both the candidate and the managed folder are resolved through the filesystem
  first, so a symbolic link inside the managed folder cannot stand in for a folder
  outside it.
- Containment is decided with `path.relative`, not by comparing the start of one
  string with another. A sibling folder named `worktrees-elsewhere` begins with
  the managed folder's spelling without being inside it, and a plain text
  comparison would accept it.
- The managed folder itself is refused. It is not a worktree, and removing it
  would take every worktree with it.
- A worktree removed by hand no longer exists, and a path that is not there cannot
  be resolved. Its parent is resolved instead and the last segment put back. This
  step is what keeps macOS working, where `/var` and the home folder are links: an
  unresolved `/var/…` never matches a resolved `/private/var/…`, and without it
  every removed worktree would read as somebody else's.
- When neither the path nor its parent resolves, the guard refuses. Ownership that
  cannot be proven is treated as ownership the fork does not have.
- The checks are synchronous, like the `worktreeExists` check beside them. The
  sweep's tests run on a test clock that never advances on its own, so a real
  asynchronous wait inside the sweep would hang them.

**Files.** Edited: `apps/server/src/orchestration/Layers/ArchivedThreadReaper.ts`
and its test.

**Upstream status.** Not filed, for the reason given in Patch 1. The sweep itself
is this fork's, so upstream does not carry this fault.

**Marker.** `refused-foreign-worktree`, the warning code emitted when the guard
rejects a path outside T3's managed worktree root. The guard's tests prove the
path-containment behavior, while this bundle marker proves the installed server
contains that tested guard.

## Patch 4 — steer a running turn from a phone (removed 2026-08-16)

**Upstream shipped it.** `v0.0.34-nightly.20260816.1109` renders a Send button
beside Stop while a turn runs, gated on `showSendWhileRunning`, and
`ChatComposer.tsx` passes `isMobileViewport` for that flag. A phone therefore
gets the button this patch existed to add, so the patch was dropped during the
rebase onto that nightly rather than resolved against it.

The label differs: upstream calls it "Send message" where this fork called it
"Steer the agent". The behaviour is the same, and one word is not worth a
patch that has to be rebased every night.

This entry stays as a record. Delete it once nobody wonders where the button
went.

## Patch 5 — show the files Git ignores in the file explorer

**Commit:** `feat(web): show the files Git ignores in the file explorer`

**Why.** A `.env` file never appeared in the file explorer, and neither did any
other file named in `.gitignore`. George edits those files often, so their
absence blocked ordinary work.

The cause is not in this repository. The server builds its file list with
`FileFinder.create` from the compiled package `@ff-labs/fff-node`, and that
package drops every ignored path inside its own binary. Its `InitOptions` and
`SearchOptions` carry no flag to keep them. So the server never sent those
paths, and no change in the browser could have shown them.

**What.** The server asks Git for the ignored paths as a second source, and
merges them into the answer when the caller sets `includeIgnored`. A control in
the file explorer header sets that preference. It is off by default and the
browser remembers it. Three lists follow the one control: the file explorer
tree, the `@` mention menu, and the file picker.

**Design notes.**

- `.git` and `node_modules` stay hidden at all times. This is what makes the
  patch affordable rather than a nice idea. Measured on this repository:
  `git ls-files --others --ignored --exclude-standard` returns 230,620 paths in
  2.0 seconds, which is nine times the 25,000 entry cap and would push every
  real file out of the tree. Adding pathspecs that exclude those two names
  leaves 1,610 paths in 0.84 seconds.
- The pathspec is not the only guard. `toIgnoredEntries` also drops any path
  holding one of those segments, so a pathspec that a future Git version reads
  differently cannot flood the tree.
- `apps/server/src/ws.ts` needed no edit, which beats fork rule 4 outright. Both
  handlers pass the whole request object through. The list handler spreads that
  object into `ProjectListEntriesError`, but that class is a
  `Schema.TaggedErrorClass` with a fixed field list, so it drops the new field
  and the wire format is unchanged.
- The contract field is optional. That is why no mobile file changed and why
  every existing test still proves the old behavior: an absent field means
  "hide the ignored files", which is what every caller sent before.
- The preference read sits inside the two query hooks, `useProjectEntriesQuery`
  and `useProjectPathSearch`, not at the call sites. That is what keeps
  `ChatComposer.tsx`, `ProjectFilePicker.tsx` and `packages/client-runtime` out
  of the diff. It also means the client cache key changes on its own, because
  the key is built from the request object.
- The preference uses `useLocalStorage`, not `ClientSettings`. The settings
  route would add two more edits to `packages/contracts/src/settings.ts` for no
  user gain, and `useLocalStorage` already tells every component in the tab
  about a change, so all three lists update together.
- The preference hook lives in `apps/web/src/showIgnoredFilesPreference.ts`, not
  beside the button, and the button is its own file. `state/queries.ts` reads
  that hook, and a state module must not pull button and tooltip components into
  its module graph. `apps/web/src/editorPreferences.ts` sits at the same level
  for the same reason.
- Ignored results rank after the indexed results in a search, never mixed in.
  The native index returns no score, so the two lists cannot interleave by rank.
- The ignored list is cached for 60 seconds per workspace. `refresh` also clears
  it. The expiry is the part that matters: a `.env` file created in a terminal
  fires no refresh event, so without an expiry it would stay invisible until the
  server restarted.
- **The control does nothing in a folder that is not a Git repository.** Git
  cannot list ignored files there. The service treats that case, a missing Git,
  a timeout and a broken repository identically: an empty list. Its error type
  is `never`, so the control can never break the file explorer. Showing ignored
  files in a plain folder needs a filesystem walk, which rule 6 forbids.

**Files.** New: `apps/server/src/workspace/IgnoredWorkspaceEntries.ts` and its
test, `apps/web/src/showIgnoredFilesPreference.ts`,
`apps/web/src/components/files/ShowIgnoredFilesToggle.tsx`. Edited:
`packages/contracts/src/project.ts`,
`apps/server/src/workspace/WorkspaceEntries.ts`, `apps/web/src/state/queries.ts`,
`apps/web/src/components/files/projectFilesQueryState.ts`,
`apps/web/src/components/files/FileBrowserPanel.tsx`.

**Upstream status.** Not filed, for the reason given in Patch 1. Upstream
carries the same gap.

**Risk to watch.** A project with a very large ignored folder, for example a
Python `.venv`, returns far more than the 1,610 paths this repository gives. The
5,000 entry cap and the 10 second timeout keep that bounded, but the tree would
then show a partial `.venv`. The fix, if it ever bites, is a second pass with
`--directory --no-empty-directory`, which took 0.057 seconds here and returns
one row per wholly-ignored folder.

## Patch 6 — every folder starts shut in the file explorer

**Commit:** `feat(web): start every folder shut in the file explorer`

**Why.** The file explorer opened the top two levels of folders by itself.
George wants a quiet tree that opens only where he taps.

**What.** `initialExpansion` changes from `1` to `"closed"`, and the panel now
carries the reader's open folders across an entry refresh.

**Design notes.**

- The one-word change alone would have made the product worse, not better. The
  panel calls `model.resetPaths(treePaths)` on every entry refresh, roughly
  twice a minute, and that call builds a new store which forgets which folders
  are open. Until now the loss was invisible, because depth 1 came back each
  time. With folders shut by default, a folder George opened would shut again on
  its own within a minute.
- `readExpandedDirectoryPaths` reads the open folders before the panel swaps in
  the new entry kinds, because the current kinds describe the rows the tree
  still holds. The list goes back through `resetPaths`'s
  `options.initialExpandedPaths`.
- The reveal effect is untouched. Opening a file from the chat or the file
  picker still opens the folders that hold it. George asked to keep that.
- `flattenEmptyDirectories` stays `true`. A chain of single-child folders is one
  row, which is a display choice and not an expansion.
- The tree library is at `1.0.0-beta.4`. Both `initialExpandedPaths` and
  `isExpanded` are in its published types, so the risk is low, but a version
  bump should re-check this patch by hand.

**Files.** New: `apps/web/src/components/files/fileTreeExpansion.ts` and its
test. Edited: `apps/web/src/components/files/FileBrowserPanel.tsx`.

**Upstream status.** Not filed. This is a preference, not a fault.

**Marker.** `data-file-tree-initial-expansion`, an attribute on the panel
element.

## Patch 7 — give `git push` time to run the pre-push hook

**Commit:** `fix(server): give git push time to run the pre-push hook`

**Why.** A commit and push from T3 Code failed with:

```
Git command failed in GitVcsDriver.pushCurrentBranch.pushWithUpstream (…):
Git command timed out.
```

That message reads as a network fault. It was not one. `git push` runs the
repository's pre-push hook, and people put whole test suites in that hook. Every
push in `pushCurrentBranch` used `runGit`, which passes no timeout, so all four
fell back to `DEFAULT_TIMEOUT_MS`, 30 seconds. A hook that runs a type check
passes 30 seconds easily.

Upstream already understood the problem for the other half of the pair.
`COMMIT_TIMEOUT_MS` in `apps/server/src/git/GitManager.ts` allows the pre-commit
hook 10 minutes, and `GitManager` passes it on every commit. Push received no
such allowance. The asymmetry looks like an oversight, not a decision.

**What.** A new `runGitPush` helper wraps every push command in
`pushCurrentBranch`. It carried a 10 minute allowance until the rebase onto
`v0.0.34-nightly.20260816.1109`, where upstream removed the push timeout
altogether with `timeoutMs: null`. That is the better answer, so the helper now
carries upstream's decision and this fork keeps only the failure detail. Both
callers of `pushCurrentBranch` gain the longer allowance with no change of
their own, and no interface changed.

The rebase onto `v0.0.36-nightly.20260827.1205` added a fifth push,
`GitVcsDriver.pushCurrentBranch.pushOwnBranch`. Upstream added it so a branch
that tracks its base publishes under its own name instead of writing its
commits to the base branch. That push runs through the helper too, so every
push in `pushCurrentBranch` still names the pre-push hook when it fails.

The helper also names a better cause when a push exits non-zero. The default
detail says only that Git exited non-zero; a rejected pre-push hook is the
common reason and is worth naming.

**Design notes.**

- The timeout sits inside `pushCurrentBranch`, not in its options. Adding an
  option would have meant editing both call sites and the `GitVcsDriver`
  interface for a value neither caller would ever vary.
- Only `push` changed. A longer default for every Git command would make a
  genuinely hung `fetch` take 10 minutes to report, and no hook runs there.
- Commit needed no change. It already had its 10 minutes.
- The regression test drives a real repository and a real push, and wraps the
  process spawner so a push sleeps five virtual minutes. Effect's test clock
  makes that cost about one real second. Without the patch the test fails with
  the exact message quoted above.

**Files.** Edited: `apps/server/src/vcs/GitVcsDriverCore.ts` and its test.

**Upstream status.** Not filed, for the reason given in Patch 1. Upstream
passes `timeoutMs: null` on every push of its own, so the timeout half of this
patch is gone. Only the failure detail remains this fork's.

**Marker.** `A pre-push hook may have rejected it.`, the failure detail the push
helper supplies.

## Patch 8 — branch naming a repository can live with

**Commits:**

- `feat: let a project set its own branch prefix in t3.json`
- `fix(server): name a thread's worktree folder after the thread`
- `fix(server): follow a branch change as the status poll reports it`
- `feat(web): add a refresh button for git and pull request status`

**Why.** A worktree showed no pull request after its branch was renamed from
`t3code/cloudflare-r2-object-storage` to `george/nrg-33`. Reading the code
showed the association was healthy and recovered on its own. Under it sat a
real design gap, and three smaller faults that made the gap hard to see.

The gap: T3 Code named every branch `t3code/<slug>`, and a repository with its
own branch convention could not keep it. `nerdragegaming/CLAUDE.md` requires
`<username>/<ticket>`. Any repository with a branch rule, or with continuous
integration keyed on a branch prefix, meets this on its first task. The two ways
out both cost something. Keep `t3code/…` and break the convention, or rename by
hand and lose the pull request badge until the next turn ends.

**What.**

1. **A project sets `branchPrefix` in `t3.json`.** A project that sets nothing
   keeps `t3code`, so nothing changes for anyone who leaves the file alone.
   `isTemporaryWorktreeBranch` now takes the prefix, because the placeholder
   branch carries it. This is the trap in the whole change: miss it and the
   first-turn rename skips every configured project, while the drift follower
   adopts a placeholder as a real branch.
2. **The worktree folder takes the thread's name**, not the branch's. The branch
   it starts with is a placeholder that the first turn renames, so a folder
   named after that branch was wrong for the life of the worktree. That stale
   folder name is what made a healthy system look broken.
3. **The drift follower runs on a status change**, not only at turn completion.
   The client hides a thread's pull request while the recorded branch and the
   checked-out branch disagree, so a `git checkout` early in a long turn hid the
   pull request for the whole turn.
4. **The branch toolbar gained a refresh button.** T3 Code re-asks the hosting
   provider about a pull request at most once every two minutes, and a pull
   request opened with `gh pr create` does not shorten that wait. Window focus
   and opening the git menu already refreshed, but neither is discoverable to
   somebody watching a badge that has not appeared.

**Design notes.**

- `branchPrefix` is a flat key, matching `defaultThreadEnvMode` beside it. An
  earlier sketch nested it under `branch` to leave room for a `template` key.
  Nothing is building a template, so the nesting bought nothing.
- The prefix reaches the server through `T3ProjectFileLoader`, resolved once at
  layer construction. Resolving it inside the reactor's own effects would have
  put the loader in the reactor's published service type.
- The status-change follower holds the branch it last saw per folder. A
  working-tree edit publishes a status too, and that must cost a map lookup
  rather than a read of the whole thread projection.
- Detecting a new pull request without asking the provider is not possible, and
  asking is the thing the two-minute cache exists to limit. A button the user
  presses is the honest answer.
- A quoted `"refs/heads/…"` from a model used to leave `refs/heads/` inside the
  branch name, because quotes were stripped after that prefix was tested. The
  order is now the other way round.

**Files.** New: `apps/server/src/project/BranchPrefix.ts`,
`apps/mobile/src/features/threads/t3-project-file-branch-prefix.ts`,
`docs/internals/branch-naming.md`. Edited: `packages/contracts/src/t3ProjectFile.ts`,
`packages/contracts/src/git.ts`, `packages/shared/src/git.ts`,
`packages/client-runtime/src/state/gitActions.ts`, the two orchestration
reactors, `apps/server/src/vcs/VcsStatusBroadcaster.ts`,
`apps/server/src/vcs/GitVcsDriverCore.ts`, one call in `apps/server/src/ws.ts`,
and the web and mobile thread-start paths.

**Upstream status.** Not filed, for the reason given in Patch 1.

**Markers.** `First segment of the branch name`, the schema description that
reaches both bundles, and `Refresh git and pull request status`, the tooltip on
the new button.

## Patch 9 — a thread survives losing its worktree folder

**Commit:** `feat(server): rebuild a thread's worktree when the folder is gone`

**Why.** A thread in the `nrgevents` project stopped working on 14 August 2026.
Every turn failed:

```
The folder this thread runs in no longer exists:
'/Users/georgejabbour/.t3/worktrees/nrgevents/t3code-5cc9d0b7'.
Something removed it outside T3 Code.
```

The message was accurate. The thread had never been archived, so the nightly
sweep had not touched it: its `archived_at` was null and its whole event history
held no archive event. The sweep's three git removals that morning were against
other repositories. What removed the folder is not recoverable from the logs,
which had rotated.

The fault worth fixing is what happened next. **The thread was finished.** Its
branch was still there, holding everything that had been committed, and one
`git worktree add` would have restored it. T3 Code offered no way to run that,
and its own error message told the user to "create the folder again" without
giving them any means to.

**What.** Before a turn starts a provider session, the thread's worktree is
checked out again at its recorded path from its recorded branch. Three
conditions gate it, and each is a refusal to guess:

- The thread records both a worktree path and a branch.
- The path sits inside the server's `worktreesDir`. A path anywhere else names
  a checkout T3 Code did not make.
- The folder is absent. An existing folder is never touched.

The thread then shows an activity saying the folder was rebuilt and that
uncommitted work is not in it. A folder that reappears silently, missing work,
reads as data loss.

`isManagedWorktree`, `canonicalPath` and `worktreeExists` moved out of
`ArchivedThreadReaper.ts` into `project/ManagedWorktree.ts`. The sweep asks
"may I remove this?" and the turn asks "may I rebuild this?", and both must
answer the same way. Their comments moved intact, including the August 2026
incident that made the containment test necessary.

**Design notes.**

- The check sits in `ensureSessionForThread`, the one place every provider
  session start passes through, and directly before the cwd check that fails.
- The rebuild is automatic rather than a button. T3 Code created the folder, so
  recreating it restores the state T3 Code already believes it is in. A button
  would leave the thread broken until somebody found it.
- A failure is swallowed to a warning. The branch being gone is the real case,
  and the turn's own error already names the missing folder.
- The `runOnWorktreeCreate` setup script does **not** run. It can be slow and
  it can start containers, neither of which belongs in an unattended turn
  start. Run it from the scripts menu when the folder needs it.

**Files.** New: `apps/server/src/project/ManagedWorktree.ts`. Edited:
`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` and its test,
`apps/server/src/orchestration/Layers/ArchivedThreadReaper.ts`.

**Upstream status.** Not filed, for the reason given in Patch 1.

**Marker.** `Rebuilt this thread's worktree`, the activity summary.

## Patch 10 — the idle-agent timeout is a setting

**Commits:**

- `feat(server): make the idle-agent timeout a setting`
- `fix(shared): keep the idle timeout a Duration through a settings patch`

**Why.** An agent that nobody has spoken to for hours keeps its process and the
memory that process holds. `providerSessionIdleTimeout` in the server settings
lets a machine reclaim it. `ProviderSessionReaper` reads the value.

**The trap, and the bug it caused.** On 14 August 2026 no setting could be saved
at all. Every write failed:

```
ServerSettingsError: Server settings write-file failed at …/settings.json.
  cause: SchemaError: Expected Duration at ["providerSessionIdleTimeout"]
```

`applyServerSettingsPatch` merges a patch into the current settings with
`deepMerge`. A `Duration` is an opaque object, so the merge walks into it and
returns a plain object that is no longer a `Duration`. The settings file then
fails to encode, and because the whole file is written at once, that one field
blocked **every** setting, including the provider screen this fork's user was
trying to edit.

The two `Duration` fields upstream already ships, `automaticGitFetchInterval`
and `providerHealthRefreshInterval`, are destructured out of the merge and put
back whole for exactly this reason. This fork added a third `Duration` and did
not add it to that list. The fork's own test layer carried a comment naming the
hazard; the production path never got the same treatment.

**The rule this leaves behind.** Any new `Duration` in `ServerSettings` must be
destructured out of `patchForMerge` in `packages/shared/src/serverSettings.ts`
and restored whole afterwards. A `Duration` that reaches `deepMerge` breaks the
settings file for every field.

**Files.** Edited: `packages/shared/src/serverSettings.ts` and its test,
`packages/contracts/src/settings.ts`, `apps/server/src/serverSettings.ts`,
`apps/server/src/provider/Layers/ProviderSessionReaper.ts`.

**Upstream status.** Not filed, for the reason given in Patch 1. The merge
hazard itself is upstream's, and it bites any repository that adds a `Duration`
setting.

**Marker.** `providerSessionIdleTimeout`, in `dist/bin.mjs`, the server bundle.

## Patch 11 — pick which Claude subscription a thread uses

**Commits:**

- `feat: read how much of each Claude subscription is left`
- `feat: choose a Claude subscription from the sidebar and settings`

**Why.** One Claude provider instance already carries its own `homePath`, which
becomes `CLAUDE_CONFIG_DIR`, so each instance signs in to its own claude.ai
account. Several subscriptions could therefore be connected at once, and
nothing showed how much of any of them was left or made one of them the
subscription new threads use. Choosing meant opening settings and reading
instance names that say nothing about remaining capacity.

**What.** A selector, in the sidebar footer and on the provider settings
screen. It lists every enabled Claude instance with the share of its five-hour
window still available, adds those shares for the header the way the Claude
Code selector does, and marks the one new threads use. Picking one writes
`activeSubscriptionInstanceId`, and a thread with no choice of its own takes
it.

**Nothing routes on its own.** No thread moves between subscriptions, and none
is chosen for a person. That is deliberate: a provider session is bound to the
credentials directory it started in, so moving a live thread would cost it its
resume cursor and start a new provider session. The number beside each row is
there so a person decides.

**The experimental method, and why it is quarantined.** The Claude Agent SDK
reports plan utilization through:

```
usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
```

Its own documentation says the API may change or be removed in any release and
that the name will change once it settles. This fork rebases onto nightly
builds, so that rename arrives unannounced.

Every use of it sits in `apps/server/src/provider/ClaudeSubscriptionUsage.ts`,
and the call is a lookup by string rather than a typed method. When the name
changes, the lookup returns undefined, the probe reports that usage is not
available, and the selector lists the subscription with no percentage beside
it. Nothing throws, and no other file has to know the method ever existed.
Restoring the number is then a one-line edit to one constant.

**Design notes.**

- Reading usage spawns a short-lived Claude subprocess per instance, the same
  way the capabilities probe already does, so answers are held for five
  minutes. The refresh control asks again.
- The cache key carries the instance configuration, so an edited instance is
  asked again instead of answering from the entry its old settings filled.
- The header shows a total only when at least one subscription reported a
  window. A zero would read as "nothing left" rather than "nothing known".
- The sidebar entry resolves its own environment and writes its own setting, so
  this fork's edit to `SidebarChrome.tsx` is one line.
- `activeSubscriptionInstanceId` counts only while the instance it names is
  still configured. A removed instance falls back to the previous order rather
  than pinning threads to something that is gone.

**Files.** New: `packages/contracts/src/subscriptionUsage.ts`,
`packages/shared/src/subscriptionUsage.ts`,
`apps/server/src/provider/ClaudeSubscriptionUsage.ts`,
`apps/server/src/provider/SubscriptionUsageService.ts`, and three components
under `apps/web/src/components/subscriptions/`. Edited, a line or two each:
both package indexes, `rpc.ts`, `RpcAuthorization.ts`, `settings.ts`,
`server.ts`, one call in `ws.ts`, `client-runtime/state/server.ts`,
`SidebarChrome.tsx`, `ProviderSettingsPanel.tsx` and `ChatView.tsx`.

**Upstream status.** Not filed, for the reason given in Patch 1.

**Markers.** `t3/provider/SubscriptionUsageService`, the service tag, and
`Add another subscription`, the button label.

## Patch 12 — how often a plan runs out

**Commit:** `feat: record how high each plan window climbs`

**Why.** The selector shows what is left right now. It could not answer the
question behind that number, which is whether a plan runs out again and again
or whether one bad afternoon stood out. The Usage page does not answer it
either: it reads local transcripts for token cost, and its own documentation
says subscription billing is separate from what it shows.

**What.** A reading is taken every thirty minutes and folded into a record of
window peaks. The selector draws those peaks under the subscription in use, as
a bar per window with a count: "ran out in 3 of the last 18".

**One number per window, not a time series.** Utilization only climbs inside a
rate-limit window and returns to zero when the window resets, so the highest it
reached is the whole story. Two subscriptions over ninety days come to roughly
a thousand rows rather than tens of thousands of readings. A window is
identified by its reset time, which the provider states exactly, so two samples
naming the same reset time are the same window.

**Design notes.**

- The record is a JSON file beside the state database, not a table. A migration
  numbered by this fork collides with the first migration upstream adds at the
  same number, and this fork rebases onto a nightly most days. The file is
  written to a temporary name and moved into place, so a reader never sees half
  of it.
- Sampling is skipped whenever `BackgroundPolicy` says the machine has no
  reason to be working, so a sleeping laptop does not spawn a Claude process
  every half hour. A skipped sample leaves a gap rather than a wrong number,
  because peaks only climb and the next reading still catches the high mark.
- The window still open is excluded from the counts. It is part-way through, so
  counting it would report a quiet afternoon as a window that never ran out.
- A window the provider reports with no reset time is skipped. Without one
  there is no way to tell a new window from the one before it, and merging two
  windows into a row would invent a peak that never happened.
- 95% counts as having run out, in one shared constant, so the sampler and the
  view cannot disagree about it.

**A limitation worth knowing.** Sampling only sees windows while the server
runs. A limit reached overnight with T3 Code closed is missed, and the record
understates it.

**Files.** New: `apps/server/src/provider/SubscriptionUsageHistoryStore.ts`,
`packages/shared/src/subscriptionUsageHistory.ts`, and
`apps/web/src/components/subscriptions/SubscriptionHistory.tsx`. Edited, a line
or two each: `subscriptionUsage.ts` in contracts, `rpc.ts`,
`RpcAuthorization.ts`, `server.ts`, one call in `ws.ts`,
`client-runtime/state/server.ts`, and the two selector components.

**Upstream status.** Not filed, for the reason given in Patch 1.

**Markers.** `subscription-usage-history.json`, the file the record lives in,
and `ran out in`, the count the history strip prints.

## Patch 13 — a repository's own skills and commands reach the menus

**Commit:** `fix: show a repository's own skills and commands in its thread`

**Why.** A skill or slash command stored inside a repository never appeared in
the `/` menu or the `$` picker. The user could run it by typing the name,
because the Claude command-line tool inside the thread reads project scope
correctly. Only T3 Code's menus missed it.

**The cause is one variable.** `ClaudeDriver.ts` reads the working directory
from `ServerConfig`, which is the directory the **server process** started in.
That is the user's home folder, confirmed live: the running server's working
directory is `/Users/georgejabbour`. It then feeds both discovery paths, so
`<cwd>/.claude/skills` resolves to `~/.claude/skills`, the user-scope
directory. The project scan re-scanned user scope. Project support existed all
along; the input was wrong.

**What.** A new service answers the same question per directory. A thread asks
about its own working directory, and the composer merges the answer into the
provider's lists. A repository entry wins a name it shares with a user entry,
because the repository's is the more specific one.

**Why a second list rather than moving discovery to the thread.** Moving it
would change the provider snapshot shape, the disk cache that outlives a
restart, and the client that reads them, on files upstream edits often. A
second list is additive. It also steps around two traps at once: the probe
cache holds a single entry keyed on the working directory, and the status cache
writes the provider's list to disk, where a saved list could outlive the
directory it came from. Neither applies to a list computed on demand and never
stored.

**No subprocess per thread.** Skill discovery already reads the file system.
Slash commands were learned from a Claude subprocess, which reports only what
it sees from where it started, so this reads `.claude/commands` and
`.agents/commands` instead. Both scans are directory listings, so a thread
costs a listing rather than a process.

**Design notes.**

- Command names follow the tool: a file gives a flat name, and a file one level
  down gives a namespaced one, `linear/scope.md` reading as `linear:scope`.
- Both scans open a path rather than read a link, so a symbolic link resolves
  to what it points at. George's command folders are entirely links, and a scan
  that skipped links would report nothing.
- `.claude` wins a name collision with `.agents`, matching the order skill
  discovery already uses.
- The answer is held for fifteen seconds. A person who writes a skill expects
  the menu to show it without restarting anything.

**Files.** New: `apps/server/src/provider/Drivers/ClaudeProjectCommands.ts`,
`apps/server/src/provider/ProjectPromptsService.ts` and
`apps/web/src/hooks/useProjectPrompts.ts`, each with tests. Edited, a line or
two each: `server.ts` in contracts, `rpc.ts`, `RpcAuthorization.ts`,
`server.ts`, one call in `ws.ts`, `client-runtime/state/server.ts`, and two
merge points in `ChatComposer.tsx`.

**Not done.** `CodexDriver.ts` carries the same shape and was not changed.

**Upstream status.** Not filed, for the reason given in Patch 1. This one is a
plain defect and belongs upstream.

**Markers.** `discoverClaudeProjectCommands`, the scan, and
`provider.getProjectPrompts`, the request the client sends.

## Patch 14 — a Duration no longer blocks every settings write

**Commit:** `fix(server): stop a Duration from blocking every settings write`

**Why.** On 19 August 2026 no setting could be changed in the user interface.
A toggle looked like it did nothing. An edit typed straight into
`~/.t3/userdata/settings.json` still worked, because the read path and the
write path are separate.

**The failure.** Every save ended this way:

```
ServerSettingsError: Server settings write-file failed at …/settings.json.
  cause: SchemaError: Expected Duration at ["providerSessionIdleTimeout"]
```

**The root cause.** This is the same field as Patch 10 and a different code
path. Patch 10 fixed the merge, in `packages/shared/src/serverSettings.ts`.
This one is the write.

`stripDefaultServerSettings` in `apps/server/src/serverSettings.ts` keeps the
settings file small. It walks the settings object and drops every value that
still equals its default. The walk went into a `Duration`, which is built from
a class and holds its parts under one private key. Copying those keys produced
an object literal that is no longer a `Duration`, and the file then failed to
encode. The whole file is written at once, so that one field blocked **every**
setting.

A list named `ATOMIC_SETTINGS_KEYS` held the two `Duration` fields upstream
ships, `automaticGitFetchInterval` and `providerHealthRefreshInterval`, out of
the walk. This fork added a third `Duration` and did not add it to that list.
The user's own file carried `"providerSessionIdleTimeout": 43200000`, which is
not the default, so the walk went in on every save.

**The fix.** The walk now takes a value apart only when it is an object
literal. `isPlainRecord` reads the prototype to decide. Any other value is
compared whole with `Equal.equals`. A `Duration` this fork adds next needs no
list entry, and neither does any other value built from a class. The two
interval names left `ATOMIC_SETTINGS_KEYS` because the guard covers them, and a
test now proves it.

**The second half: the failure is now in the log.** `updateSettings` returns
this error to the client over the websocket, and the client shows nothing. That
is why a broken save looked like a control that does not work. `updateSettings`
now writes the failure to the server log with `Effect.logError`, naming the
path, the operation and the cause. The log line sits in the service, so it
covers every caller, not only the one remote procedure call.

**Tests.** Four in `apps/server/src/serverSettings.test.ts`. Each one was seen
to fail before the fix and pass after it.

1. Save an unrelated setting after the idle timeout moves off its default.
2. Save a setting when the file already on disk holds a non-default idle
   timeout. This is the user's real file shape.
3. Keep a non-default `automaticGitFetchInterval` whole on disk. This covers
   the two names removed from `ATOMIC_SETTINGS_KEYS`.
4. Write a failed update to the server log.

```sh
vp test run src/serverSettings.test.ts   # from apps/server
```

**Files.** Edited: `apps/server/src/serverSettings.ts` and
`apps/server/src/serverSettings.test.ts`. No other file changed.

**Upstream status.** Not filed. Upstream ships `stripDefaultServerSettings` with
the same shape, so upstream will meet this the day it adds its own third
`Duration`. The guard belongs there.

**Marker.** `no setting was saved`, part of the log message. The guard in
`stripDefaultServerSettings` holds no string literal, so no marker can watch it.
The four tests above are its check. Run them before an install.
