# Fork consolidation TODO

Assessment date: 2026-10-06. Six tasks remain after adoption of the October 6 nightly.
This file tracks pending work. Task numbers remain unchanged for reference.
“Keep” tasks retain and verify a feature; they do not require a rewrite.

## Reference commits

- Adopted nightly: [`v0.0.46-nightly.20261006.2735`](https://github.com/pingdotgg/t3code/releases/tag/v0.0.46-nightly.20261006.2735), commit `fd1c3386c4d60f3477ab3f13c87537848de099f5`.
- Fixed fork references describe the original differences at [`20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618`](https://github.com/georgejabbour/t3code/tree/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618).

Recheck current source in `t3/assess-fork-patches-against-nightly` before each change.

## Working rules

1. Work on one numbered task at a time.
2. Recheck the target branch and current source before each task.
3. Preserve unique behavior and saved data before removing duplicate code.
4. Run focused checks before marking a task complete.
5. Remove each task from this file after completion.

Browser and device checks require George's explicit authorization.
Follow repository limits on checks and protect live T3 data.

## Task 13: Consolidate native and extension stack presentation

- [ ] Complete implementation and focused verification.

**Decision:** Consolidate. **Original patch:** 16.

**Reason:** Use native stack membership and UI. Retain the gh-stack adapter for local operations.

**Change:** Upstream has host-native stacks, layer lists, popovers, and menus. The fork displays a second chain card beside them. Share presentation for native stacks. Retain local and unpublished branches, submit, sync, and checkout through GhStackCli. Extension chains and native stack IDs describe different systems. Keep upstream expected-commit checks for merge actions.

**Dependency:** Preserve repository and environment identity. Keep extension mutation behavior available for Task 14.

**Completion check:** Native stacks use upstream membership and merge protections. Local and unpublished branches retain submit, sync, and checkout. Extension chains do not become native stack IDs.

**References:** [Fork duplicate presentation](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx#L730); [Native stack API](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/pullRequest/GitHubPullRequestCli.ts#L2231); [Native stack presentation](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/web/src/components/pullRequest/PullRequestStackLayers.tsx); [Retained extension adapter](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/git/stack/GhStackCli.ts).

**Result:** Pending.

**Current reassessment:** Native stack layers, menus, and host membership remain available. The fork chain card remains separate. Share presentation while retaining local and unpublished extension branches and their commands. Preserve native expected-commit checks; extension chains do not become native stack IDs.

## Task 14: Coordinate stack mutations and refresh on the server

- [ ] Complete implementation and focused verification.

**Decision:** Refactor. **Original patch:** 16.

**Reason:** Coordinate ordinary VCS mutations and extension stack mutations on the server.

**Change:** The fork’s client stack scheduler remains separate from ordinary VCS commands and cannot coordinate other clients. No shared native server mutation coordinator covers both paths. Use a small shared KeyedLock keyed by repository identity across ordinary and extension mutations. Refresh the affected checkout, stack, and pull request state together. Consume the returned refreshed view. Pass the branch to mobile discovery.

**Dependency:** Task 13 defines retained extension actions. Preserve repository and environment identity.

**Completion check:** Focused integration tests prevent conflicting mutations from separate clients. Actions refresh the checkout that runs the command. Mobile discovers the requested branch from another checkout.

**References:** [Mismatched map key](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/state/gitStacks.ts#L143); [Caller key](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/routes/_chat.pull-requests.tsx#L1952); [Independent client scheduler](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/packages/client-runtime/src/state/gitStacks.ts#L22).

**Result:** Pending.

**Current reassessment:** The shared read cache does not serialize mutations across clients. This task requires a shared server lock using the existing primitive, not an assumed native repository scheduler.

## Task 15: Shrink ignored-file browsing around native directory reads

- [ ] Complete implementation and focused verification.

**Decision:** Consolidate. **Original patch:** 5.

**Reason:** Upstream already browses ignored files. Keep only the chosen hide preference and supplemental search.

**Change:** The native tree reads each directory from disk and marks ignored entries. The fork hides them by default and excludes node_modules. Restore native tree behavior unless that preference remains intentional. Preserve ignored-path search for mentions and file pickers, which still use the native index. Keep the stale-request guard when a preference changes.

**Completion check:** Focused tests cover ignored directories, .env files, mentions, file pickers, and stale requests. Record the chosen default visibility and node_modules behavior.

**References:** [Native directory browsing](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/workspace/WorkspaceEntries.ts#L305); [Fork filtering](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/workspace/WorkspaceEntries.ts#L335); [Retained supplemental search](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/workspace/IgnoredWorkspaceEntries.ts).

**Result:** Pending.

**Current reassessment:** Native physical directory reads include ignored entries and node_modules, while indexed search remains separate. The fork adds hide preferences and supplemental ignored-path search. Consolidation remains valid; choose visibility and node_modules policy before removing filters.

## Task 16: Retain only missing clipboard behavior

- [ ] Complete implementation and focused verification.

**Decision:** Keep. **Original patch:** 2.

**Reason:** Retain iOS selection handling, selection restoration, and native-write failure fallback where upstream lacks them.

**Change:** Upstream already provides an HTTP execCommand fallback, focus restoration, and extra clipboard formats. Keep missing iOS range handling, page selection restoration, and intentional fallback after a native write failure. Retain required shared-helper callers and support detection. Verify browser-specific behavior before removal.

**Completion check:** Focused tests cover HTTP fallback, iOS selection handling, selection restoration, failure reporting, and required helper callers. Preserve rich clipboard content.

**References:** [Native HTTP fallback](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/web/src/hooks/useCopyToClipboard.ts#L54); [Fork refinements](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/hooks/useCopyToClipboard.ts#L55).

**Result:** Pending.

**Current reassessment:** The original HTTP-gap claim remains obsolete. Preserve rich clipboard formats and native focus restoration. The smaller remaining differences require real browser evidence when George authorizes that check.

## Task 21: Retain the bundled fonts as one appearance change

- [ ] Complete implementation and focused verification.

**Decision:** Keep. **Original patch:** Additional.

**Reason:** Keep if these fonts remain a fork preference.

**Change:** The maintained remote adds eight font files, fallback suggestions, and license configuration. Upstream does not provide this bundle. Keep them as one independent appearance change. They do not depend on the server patches.

**Completion check:** Focused font checks cover availability, fallback suggestions, monospace restrictions, and license registration. Keep all eight required files.

**References:** [Fork font registration](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/appearanceFonts.ts#L28); [Font license entry](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/third-party-licenses.config.json#L111).

**Result:** Pending.

**Current reassessment:** All eight iA Writer Duo and Quattro font files remain present, with registration and license configuration. The bundle remains a fork preference. Keep it as one independent appearance change; verify availability and monospace rules when editing it.

## Task 22: Revalidate build workarounds against the current toolchain

- [ ] Complete implementation and focused verification.

**Decision:** Recheck. **Original patch:** Maintenance.

**Reason:** Revalidate version-specific build changes.

**Change:** The adopted catalog uses Vite+ 1.0.0 and Effect 4.0.1. Recheck the fork’s vite config import against native vite-plus. Validate the raw heic-to/csp decoder URL and optional import under production CSP. CSP is the browser’s content security policy. Validate the compiler filter against current chunk paths. Retain warning-limit and timing changes only with measurements. Task 23 updates the ledger and maintenance records.

**Completion check:** A scoped production build confirms decoder loading, optional code loading, and compiler coverage. Record measurements before retaining diagnostic suppressions.

**References:** [Fork build changes](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/vite.config.ts#L173); [Fork decoder import](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/lib/imageCompression.ts#L14); [Current dependency catalog](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/pnpm-workspace.yaml#L49); [Stale patch ledger](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/PATCHES.md#L156).

**Result:** Pending.

**Current reassessment:** The current fork still imports defineConfig from vite, while the adopted native file imports it from vite-plus. The HEIC decoder remains a raw URL import. Source inspection alone does not prove build compatibility, decoder loading, or compiler coverage.

## Assessment limits

Pending recommendations rely on source assessment and require focused verification.
Browser, native PTY, Docker, production decoder, and mobile behavior remain unverified.
The external updater remains unverified.
