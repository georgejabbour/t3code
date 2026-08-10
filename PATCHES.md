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
t3code-fork-update              # rebase onto the published nightly, typecheck, test
t3code-fork-update --install    # the above, then build and install globally
```

The script is at `~/.local/bin/t3code-fork-update`, outside this repository, so it
never makes the difference against upstream larger.

A clean rebase does not prove the patch still works. This fork's tests copy
upstream types and upstream test data. Upstream keeps adding to both, on lines
this fork never edits. Git therefore reports no conflict, and the typecheck or the
tests fail straight after. Two cases appeared while verifying
`0.0.34-nightly.20260810.1061`:

1. Upstream added two required fields to `ProcessRunOutput`, so Patch 1's test
   helper had to name them too.
2. Upstream added a test that starts a session in `/tmp/project`, one day after
   this fork made `startSession` refuse a folder that is not on disk. Tests in
   `apps/server/src/provider/Layers/ProviderService.test.ts` must name a real
   folder through the `sessionCwd` helper there. Any new upstream test in that
   file needs the same helper.

The second case was broken from 8 August 2026 and nobody saw it, because the
updater runs three test files only. Run the tests of every file this fork edits
before an install, not the three the updater names.

After an install, the script reads the built output and looks for one text marker
from each patch. A missing marker means the build lost that patch, and the script
stops with an error.

| Patch | Marker                     | File that holds the marker                  |
| ----- | -------------------------- | ------------------------------------------- |
| 1     | `runOnWorktreeRemove`      | `dist/bin.mjs`, the server bundle           |
| 2     | `execCommand("copy")`      | `dist/client/assets`, the web client bundle |
| 3     | `refused-foreign-worktree` | `dist/bin.mjs`, the server bundle           |

The second marker is the whole call, not the method name on its own. Upstream
already ships a syntax-highlighting grammar chunk that contains the word
`execCommand`, so the shorter marker would pass on a build with no patch.

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

**Commit:** `fix(server): stop the archived-thread sweep removing foreign worktrees`

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
