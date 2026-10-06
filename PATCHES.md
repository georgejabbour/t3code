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
tests fail straight after. Six cases have appeared so far. The first two appeared
while verifying `0.0.34-nightly.20260810.1061`:

1. Upstream added two required fields to `ProcessRunOutput`, so Patch 1's test
   helper had to name them too.
2. Upstream added a test that starts a session in `/tmp/project`, one day after
   this fork made `startSession` refuse a folder that is not on disk. Tests in
   `apps/server/src/provider/Layers/ProviderService.test.ts` must name a real
   folder through the `fixtureCwd` helper there. The target nightly provides
   this helper; it replaces the fork's `sessionCwd` helper. New tests need a real
   folder. This problem returned on 23 August 2026: upstream's
   `feat(codex): submit thread feedback to OpenAI (#7949)` added
   "recovers a stopped Codex session before uploading feedback", which starts a
   session in `/tmp/feedback-project`. The rebase onto
   `0.0.36-nightly.20260828.1209` stayed clean and that one test failed.

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

5. Upstream's `apps/web/src/components/settings/ProviderSettingsPanel.environment.test.tsx`
   calls `EnvironmentProviderSettings` as a plain function. It supplies
   stand-ins for `useCallback`, `useMemo`, `useRef` and `useState`, and no
   router. Patch 15 called a router hook in that component's body, so every
   test in the file threw
   `Cannot read properties of null (reading 'useContext')`. The reader is now a
   child element, which the test never renders. Any upstream test that calls a
   component this fork extends breaks the same way, and only a hook the test
   does not stand in for triggers it.

6. `0.0.38-nightly.20260831.1240` added
   `apps/mobile/src/state/use-thread-outbox-drain.test.ts`. That test stands in
   for every app-state module the file under test imports, so none of them ever
   loads for real. Patch 8 adds one more app-state import to that file, through
   `t3-project-file-branch-prefix.ts`, and the test has no stand-in for it. The
   real module reaches `apps/mobile/src/state/projects.ts`, which reaches the
   connection layer, which reaches React Native itself. The runner then fails to
   parse React Native's entry file and reports
   `RolldownError: Parse failure: Flow is not supported`, with no test run at
   all. The fork's own file now loads the project atoms inside its function
   instead of at the top, so the module graph the test walks stays clear of
   React Native. Keeping the change in the fork's own new file means no upstream
   test needs an edit. Any upstream test that stands in for a whole layer breaks
   the same way when this fork adds one more member of that layer.

The second case was broken from 8 August 2026 and nobody saw it. By default the
updater runs no tests, and even with `--test` it runs a few files only. The third
case was broken for as long, and found on 11 August 2026 by running the whole
suite. The type check caught the fourth case on 20 August 2026, before any test
ran. The fifth case, and the return of the second, were both found on
28 August 2026 while rebasing onto `0.0.36-nightly.20260828.1209`; both had been
broken for days, and neither file is one the updater runs. The sixth case
appeared on 31 August 2026, in the rebase onto `0.0.38-nightly.20260831.1240`,
in a test file upstream added in that same nightly. The type check passed and
the rebase was clean; only the whole test suite showed it. Run the tests of
every file this fork edits before an install, not the few that `--test` names.
Better, run `pnpm test` and read the result.

After an install, the script reads the built output and looks for one text marker
from each patch. A missing marker means the build lost that patch, and the script
stops with an error.

| Patch | Marker                                     | File that holds the marker                  |
| ----- | ------------------------------------------ | ------------------------------------------- |
| 1     | `runOnWorktreeRemove`                      | `dist/bin.mjs`, the server bundle           |
| 2     | `execCommand("copy")`                      | `dist/client/assets`, the web client bundle |
| 3     | `expected archive state`                   | `dist/bin.mjs`, the server bundle           |
| 5     | `IgnoredWorkspaceEntries.listIgnoredPaths` | `dist/bin.mjs`, the server bundle           |
| 5     | `t3code:file-explorer-show-ignored`        | `dist/client/assets`, the web client bundle |
| 6     | `data-file-tree-initial-expansion`         | `dist/client/assets`, the web client bundle |
| 7     | `A pre-push hook may have rejected it.`    | `dist/bin.mjs`, the server bundle           |
| 8     | `First segment of the branch name`         | `dist/bin.mjs`, the server bundle           |
| 8     | `Refresh git and pull request status`      | `dist/client/assets`, the web client bundle |
| 9     | `Rebuilt this thread's worktree`           | `dist/bin.mjs`, the server bundle           |
| 10    | `providerSessionIdleTimeout`               | `dist/bin.mjs`, the server bundle           |
| 11    | `Add another subscription`                 | `dist/client/assets`, the web client bundle |
| 12    | `subscription-usage-history.json`          | `dist/bin.mjs`, the server bundle           |
| 12    | `ran out in`                               | `dist/client/assets`, the web client bundle |
| 13    | `discoverClaudeProjectCommands`            | `dist/bin.mjs`, the server bundle           |
| 13    | `provider.getProjectPrompts`               | `dist/client/assets`, the web client bundle |
| 14    | `no setting was saved`                     | `dist/bin.mjs`, the server bundle           |
| 15    | `Turned off in Providers`                  | `dist/client/assets`, the web client bundle |
| 16    | `t3/git/stack/GitStackService`             | `dist/bin.mjs`, the server bundle           |
| 16    | `git-stack-chain-card`                     | `dist/client/assets`, the web client bundle |

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

## Compatibility with `v0.0.41-nightly.20260910.1486`

The rebase targets commit `d29c56a5c404cb0f58d3b2ac41762fa0d0ac28d4`.
The old history contains two copies of the fork series. The rebase removes
repeated copies and retains the fork behavior, including priority for worktrees
that track the requested stack.

The sidebar retains upstream's multiple pull request links beside the fork's
stack position marker. Pull request panels retain upstream navigation and native
stack refresh, plus the fork's thread directory, branch, and stack actions.
The dependency lock retains upstream's Effect patch and Vite 0.3.3. Vite 0.3.3
now includes the watcher-option behavior that the fork patched in Vite 0.3.0.
The three stack error classes use `Schema.TaggedError`, which this target supplies.
A contract test checks that each error retains its fields after encoding and decoding.

Four files need corrections after the rebase:

- `apps/server/src/git/stack/gitStack.test.ts` uses the schema decoder for its
  expected stack result. The target's type checker rejects `JSON.parse` inside
  this Effect test. The test supplies its services through one combined layer
  to remove the service-lifetime warning. Its captured input contains one `base`
  field per branch.
- `apps/server/src/orchestration/Layers/ArchivedThreadReaper.test.ts` supplies
  the new required `pullRequests` field in its saved thread test data.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` removes extra blank lines that
  the rebase retained around the fork's worktree tests.
- `packages/contracts/src/rpc.ts` uses the required format for the subscription
  refresh request. Its request fields and behavior remain the same.

The last two corrections satisfy the format check. They change no runtime behavior.
The earlier partial absorption of real-checkout adoption remains under Patch 8.

Use Node `v24.20.0` for the focused tests and these complete checks:

```sh
pnpm run typecheck
pnpm run lint
pnpm run fmt:check
pnpm test
```

The updater's `--check --target <tag> --test` path records compatibility for the
exact target and fork head. It does not install the application.

## Patch 1 — `runOnWorktreeRemove`

**Commit:** `feat(server): run a t3.json script before removing a worktree`

**Why.** T3 Code deletes a worktree, and it gives you no way to run a cleanup step
first. Every Docker stack, named volume, built image and development server
process that points at that path stays behind. Nothing refers to them any more. On
one machine, four orphan stacks collected over eight days before a person saw
them. Those stacks held 12 named volumes and 3 containers. Conductor solves this
with `[scripts] archive` in `.conductor/settings.toml`. T3 Code has
`runOnWorktreeCreate` and no equivalent for removal.

**What.** A `t3.json` script with `runOnWorktreeRemove` runs before the shared worktree service removes the checkout.
Manual removal and automatic cleanup use this service under the workspace lock.
Automatic cleanup checks eligibility before the script and repeats safety checks after it.
A failed script or timeout keeps the folder.
Manual removal returns `WorktreeArchiveScriptError` with the script output.
The client offers an explicit retry with `skipArchiveScript`.

Failed or cancelled startup also uses this service after setup starts.
It first confirms that the setup terminal process exits, including a terminal the user has already closed.
A cleanup failure keeps the folder and thread, records the claimed path, and reports the error.
Before setup starts, rollback removes only a checkout claimed by that create operation and skips the script.
Git removal can retry after a transient error without running the script again.

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

**Files.** New: `apps/server/src/project/WorktreeArchiveScriptRunner.ts`, its test, and `WorktreeRemoval.ts`. Edited: `packages/contracts/src/{t3ProjectFile,git,rpc}.ts`,
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

**Upstream status.** The target `v0.0.39-nightly.20260905.1287` provides basic
copy support on HTTP addresses. This patch retains the additional iOS selection
support, page selection restoration, fallback after a failed modern clipboard
write, and copy support at the additional call sites. Both test sets remain.
A refused fallback reports `ClipboardWriteError`, as the fork requires.

## Patch 3 — delete archived history through safe storage cleanup

**Why.** The fork adds optional daily deletion of archived conversations.
The original sweep also force-removes their worktrees before it deletes their history.
Its managed-directory guard protects foreign folders, but does not protect dirty or shared worktrees.

**What.** The sweep now dispatches `thread.delete` without scripts, filesystem access, or Git removal.
It skips running turns, starting sessions, background work, queued messages, pending approvals, and pending questions.
The command includes the archive timestamp the sweep inspects.
The decider rejects deletion if that archive state changes or new foreground work appears.
Manual deletion keeps its existing behavior.

Storage cleanup reads the retained deletion record and waits for provider and terminal cleanup.
It applies the separate worktree cleanup rules and removes eligible folders with `force: false`.
When those rules are disabled, or a safety check fails, the worktree remains.
The deletion record retains its branch and path for later cleanup attempts.

**Hook behavior.** The separate worktree removal hook remains available through the existing explicit removal flow.
Automatic storage cleanup uses the same shared removal service.
It runs the hook only after eligibility checks pass and repeats safety checks before Git removes the folder.

**Files.** The archive sweep, deletion command, decider, server wiring, settings description, and focused tests change.
The service stays in the current worktree's orchestration folders.
Adopt newer service conventions when this branch moves to the corresponding upstream version.

**Verification.** Focused tests cover daily scheduling, retryable deletion, active work, and changed archive state.
Integration tests use the real engine, projections, deletion reactor, SQLite database, and Git worktrees.
They cover disabled cleanup, clean removal, dirty files, and shared ownership.

**Marker.** `expected archive state` identifies the scheduled deletion guard in the server bundle.
The external installer marker check still expects `refused-foreign-worktree`.
Update that check before installing this revision.

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
- Upstream created its own `fileTreeExpansion.ts`, with the same name this patch
  chose, in `0.0.38-nightly.20260901.1246`. Upstream's file holds
  `areAllDirectoriesExpanded` and `setAllDirectoriesExpanded`, which serve its
  expand-all and collapse-all button. This patch no longer creates that file. It
  adds `readExpandedDirectoryPaths` to upstream's file, and it adds its own tests
  to upstream's test file. The two functions do different work and neither reads
  the other. The fork's test helper carries the name `makeOpenFolderModel`,
  because upstream's half of that test file already has a `makeModel` that
  behaves differently: upstream's helper answers with a row for every path, and
  the fork's helper answers `undefined` for a path the tree no longer holds.
  Expect a conflict in both files on the day upstream edits either one.
- The two features work together. The expand-all button opens every folder, and
  this patch then carries that whole open tree across the next entry refresh,
  because it reads the live `isExpanded()` state rather than a stored setting. A
  test in `fileTreeExpansion.test.ts` holds that pair together.

**Files.** Edited: `apps/web/src/components/files/FileBrowserPanel.tsx`,
`apps/web/src/components/files/fileTreeExpansion.ts`, and
`apps/web/src/components/files/fileTreeExpansion.test.ts`. The last two are
upstream files, and this patch adds one function to each.

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
- `test(server): cover real checkout adoption from placeholder records`

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
4. **The branch toolbar has a refresh button.** Upstream now discovers pull
   requests every minute and after relevant thread events. The fork's button
   requests an immediate refresh.

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
- Upstream supplies automatic pull request discovery. The refresh button
  remains available when the user needs an immediate status check.
- A quoted `"refs/heads/…"` from a model used to leave `refs/heads/` inside the
  branch name, because quotes were stripped after that prefix was tested. The
  order is now the other way round.
- The drift follower refuses to adopt while the CHECKED-OUT branch is a
  placeholder, because that is the first-turn rename still in flight. It no
  longer refuses when the RECORDED branch is a placeholder under a real
  checkout: that state means the branch moved outside T3 Code (`gh stack
init` and `git checkout -b` both do it), the rename it was reserved for can
  never describe the checkout the user chose, and refusing left the thread's
  pull request hidden forever. The rename's compare-and-swap keeps a
  concurrent rename from corrupting either side. Seen live on 24 August 2026:
  a `gh stack` chain on `nerdragegaming` left the record at `t3code/8e543a92`
  while the worktree sat on `george/nrg-435`.

Upstream now supplies the real-checkout adoption rule. The fork retains its
status-change test, custom branch prefixes, and immediate branch-change response.

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

`project/ManagedWorktree.ts` provides the ownership and existence checks for provider recovery.
The archive sweep delegates folder removal to storage cleanup and no longer uses these helpers.

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

## Patch 11 — select the subscription for new threads

The sidebar popover and Providers settings let a user select a subscription
for new threads. The selection writes `activeSubscriptionInstanceId`.
Existing saved selections remain valid. A running thread keeps its provider.

The popover reads native provider snapshots from the server configuration
stream. Native provider checks and live turn updates supply the usage windows.
The refresh control uses the same provider refresh and request sharing as
Usage → Limits. The fork has no separate Claude or Codex usage probe.

The header adds remaining allowance once per account. Configured instances
remain separate selectable rows, even when they share an account. A disabled
instance stays visible and opens Providers settings when selected.

**Marker:** `Add another subscription`, in the web client bundle.

## Patch 12 — retain quota window peaks

The popover shows closed quota windows as bars and counts how often their
observed peak reaches 95%. The server records native provider snapshot updates.
History reads include the latest cached snapshot. History capture adds no
provider checks or polling timer.

The store keeps a peak per account, native window ID, and reset time. It skips
readings without an account address or reset time. It keeps records for ninety
days after reset. It serializes file updates and replaces the JSON file with
an atomic rename. A malformed existing file stops recording and remains intact.

Earlier records lack account identity. The popover shows them under “Earlier”
labels, separate from the current account's history. The store preserves their
window names and sample counts without assigning them to today's sign-in.

The history records observed readings only. It can miss a peak between native
readings or while the server is stopped.

**Markers:** `subscription-usage-history.json` in the server bundle and
`ran out in` in the web client bundle.

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

**Commit:** `fix(settings): preserve atomic values when saving`

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

## Patch 15 — show Claude and Codex subscriptions together

The popover lists configured Claude and Codex instances, including disabled
instances. Each row uses its native account label, usage windows, and reset
time. Weekly-only plans and additional native windows need no fixed window
slots. The header counts each known account once and uses its latest reading.

“Add another subscription” opens the add-provider dialog in Providers settings.
“Manage in Providers” opens that settings page. A disabled row also opens the
settings page. The existing manual selection behavior remains unchanged.

**Marker:** `Turned off in Providers`, in the web client bundle.

## Patch 16 — GitHub stacks in the interface

**Commits:**

- `feat(server): read GitHub stacks and run their non-interactive commands`
- `feat(client): stack query and action atoms for the web surfaces`
- `feat(web): show GitHub stack chains and run stack actions`
- `fix(server): find a stack in whichever checkout tracks it`
- `fix(web): stack rows move the thread's own worktree`
- `fix(web): the stack chain marks only one branch "here"`

**Why.** George reviews his own work as stacked pull requests, managed by the
`gh-stack` extension (`gh extension install github/gh-stack`). T3 Code showed
each pull request on its own and knew nothing about the chain between them:
which branch sits on which, which needs a rebase after the branch below moved,
and what a merge of one link does to the links under it.

**What.** When a checkout belongs to a stack, four places say so:

1. The pull request's summary panel draws the chain — trunk-first, numbered,
   with each branch's pull request state, a "here" mark on the branch the
   reader's own worktree sits on, and a "needs rebase" flag. Beside it sit
   three commands (submit, sync, rebase upstack) and a merge whose dialog
   names every pull request that would land before it runs.
2. The git actions menu carries the same three commands.
3. A sidebar row's pull request number gains "n/N" — second of three reads
   "2/3".
4. Rows on the pull requests list page carry the same mark.

Every surface renders nothing when the checkout belongs to no stack, so a
repository without `gh-stack` looks exactly as it did.

**The safety rules, and why they are refusals rather than warnings.**
`sync` and `rebase` rewrite the history of every branch above the checkout.
T3 Code holds one worktree per thread, and another thread may have that next
branch checked out; rewriting history underneath it either fails half-way or
leaves the other thread standing on commits nothing references. So:

- The action refuses while the calling worktree holds uncommitted changes.
  Untracked files are fine.
- It refuses while any branch above the checkout is checked out anywhere else,
  naming the branch and the path that blocks it. `git worktree list` answers
  this in one read.
- Merge refuses a pull request number that belongs to no branch of the chain,
  so a typo cannot land somebody else's work.

A rebase conflict arrives as the extension's exit code 3, and the error tells
the reader the two commands that finish or undo the run. No interface here
resolves markers, and none aborts on its own: half-finished is recoverable
either way, and guessing is not.

**Design notes.**

- Everything rides two new remote procedure calls, `gitStack.view` and
  `gitStack.runAction`, keeping this fork's edit to `ws.ts` at one insertion
  block. The view answers null for "no stack", which every client reads as
  "render nothing".
- Only the extension's non-interactive invocations are used, each carrying the
  flags its documentation requires: `--auto`, `--yes`, and an explicit
  `--remote` wherever the command pushes. The remote follows
  `remote.pushDefault`, then the repository's single remote, then `origin`;
  several remotes with no default is a refusal with the one-line fix, because
  guessing wrong would push to somebody.
- The view is held fifteen seconds per checkout, so a sidebar of threads on one
  repository costs one `gh` call. Every successful action drops its entry and
  reads the chain again, so the panel redraws from the answer the action
  itself produced.
- A failed read also renders nothing: a missing or unauthenticated `gh`
  degrades to today's interface, never to an error strip beside every thread.
- The native mobile app carries one surface: the thread list row's change
  request pill gains the same "n/N" mark, in both the current and the legacy
  list. There is no pull request detail surface on native to hang a chain
  card on; the web app in a phone browser is the full experience there.
- The "here" mark is handed to the chain card by the surface that opened it,
  and is never read from the stack answer. `GitStackBranch.isCurrent` describes
  whichever checkout answered the read, and the server finds that checkout by
  searching the repository's worktrees, so the flag regularly names a branch in
  a worktree the reader has never opened. Beside a thread the card is handed
  that thread's branch; the pull requests page hands in nothing, because a
  chain drawn there is one nobody stands in.
- One function decides what a row click does, and both the tooltip and the
  click read its answer. Beside a thread a row checks the branch out and opens
  its pull request; elsewhere it only opens the pull request, and says so. The
  answer carries the three values a checkout needs, so the two paths cannot
  drift apart.
- The deterministic service tags follow the file paths:
  `t3/git/stack/GhStackCli` and `t3/git/stack/GitStackService`.

**Tests.**

```sh
pnpm test run src/git/stack/gitStack.test.ts        # from apps/server
pnpm test run src/components/stacks                 # from apps/web
```

The server tests cover the answer parser (upper-case states, absent pull
request, trunk-as-current), the worktree list reader including prunable
checkouts, the order in which checkouts are asked for a chain, the
branches-above rule, and the stderr tail. The pre-flight rules ride typed
effects over real git reads; the tests prove the pure decisions they are built
from.

The web test renders the chain rows and holds the marks apart: exactly one row
carries "here" when the checkout that answered the read sits on a different
branch than the reader's worktree, no row carries it when the card speaks for
no worktree, and a row tooltip promises a checkout only when the click performs
one.

**Files.** New: `packages/contracts/src/gitStack.ts`,
`apps/server/src/git/stack/GhStackCli.ts`,
`apps/server/src/git/stack/GitStackService.ts` and their tests,
`packages/client-runtime/src/state/gitStacks.ts`,
`apps/web/src/state/gitStacks.ts`, three components under
`apps/web/src/components/stacks/` and the chain card's test,
`apps/mobile/src/state/gitStacks.ts`, and
`apps/mobile/src/components/GitStackPositionMarker.tsx`. Edited, a few lines
each:
`packages/contracts/src/{index,rpc}.ts`, `apps/server/src/auth/RpcAuthorization.ts`,
`apps/server/src/{server,server.test,ws}.ts`, one package export line in
`packages/client-runtime/package.json`, and the render points:
`PullRequestSummaryTab.tsx`, `Sidebar.tsx`, `PullRequestRow.tsx`,
`_chat.pull-requests.tsx`, the menu block in `GitActionsControl.tsx`, the
`ChatView.tsx` and `PullRequestDetailPanel.tsx` lines that hand the thread's
branch down, and the two native list rows `thread-list-items.tsx` /
`thread-list-v2-items.tsx`.

**Where a stack is tracked, and why it changed everything above.**
The `gh-stack` extension writes the chain it knows about into a file called
`gh-stack`, inside the git directory of the checkout that set the stack up.
Git gives every linked worktree its own git directory. So a chain that one
worktree knows about is invisible from the repository root and from every
other worktree of the same repository — `gh stack view` answers "current
branch is not part of a stack" there, and answers it with the same exit code
as a repository that uses no stacks at all.

T3 Code runs each thread in its own worktree, so this is the normal case, not
an edge case. Three parts of this patch read as broken because of it:

1. The chain card showed for the pull request whose branch the thread was
   standing on, and for no other member of the chain.
2. Clicking another member created a second worktree for its branch instead of
   moving the thread's own working tree, so the thread stayed where it was and
   the new panel had no chain to draw.
3. Submit, sync and rebase upstack ran from the project's root checkout, which
   sees no stack, so all three answered "No GitHub stack covers this checkout".

The fixes, in the same order:

1. A read that names a branch now asks selected repository checkouts for the
   chain. The checkout holding the branch comes first. A checkout whose local
   `gh-stack` state contains the branch comes next. The server skips prunable
   and detached checkouts. It caps the probe list at eight entries, so one
   panel cannot start dozens of `gh` commands. A named branch that no chain
   holds reads as no stack.
2. A chain row now runs a new `checkout` action, `gh stack checkout <pr>`, in
   the thread's own worktree. That command moves that working tree onto the
   branch, and when the worktree tracks no stack yet it reads the stack from
   GitHub and starts tracking it there — which is also how the worktree gains
   the tracking that step 1 then finds. It refuses a worktree holding
   uncommitted changes, and git's own refusal passes through when another
   worktree already holds the branch, naming that directory.
3. Every other action carries the branch too, and runs in the checkout that can
   read the chain rather than in the one the caller happened to stand in.

Two smaller consequences. A successful action now empties the whole read cache
rather than one entry: one repository is reachable through its root and through
every worktree, under cache keys that cannot be related to each other, so
pretending to know which entries went stale would be a lie. And the position
mark on the pull requests list page still reads only what the project's root
checkout can see, because giving that page the same search would cost up to
eight `gh` runs per project on a page that lists every project at once.

**Upstream status.** Not filed, for the reason given in Patch 1. Upstream has
no stacked-pull-request support of any kind today; if that changes, delete
this patch and install the published `t3` again.

**Markers.** `t3/git/stack/GitStackService`, the server's own service tag, and
`git-stack-chain-card`, the test id on the chain card element.
