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

After an install, the script reads the built output and looks for one text marker
from each patch. A missing marker means the build lost that patch, and the script
stops with an error.

| Patch | Marker                | File that holds the marker                  |
| ----- | --------------------- | ------------------------------------------- |
| 1     | `runOnWorktreeRemove` | `dist/bin.mjs`, the server bundle           |
| 2     | `execCommand("copy")` | `dist/client/assets`, the web client bundle |

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
