# Fork consolidation TODO

Assessment date: 2026-10-06. Reassessment follows adoption of the October 6 nightly.

This file records the source assessment and the work that follows it.
Completed checkboxes preserve the original completed work.
Original checks precede integration. Fresh integration checks are recorded below.
“Keep” tasks retain and verify a feature; they do not require a rewrite.

## Reference commits

- Maintained remote fork: `fork/hermes-fork-patches` at [`20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618`](https://github.com/georgejabbour/t3code/tree/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618).
- Latest published nightly adopted here: [`v0.0.46-nightly.20261006.2735`](https://github.com/pingdotgg/t3code/releases/tag/v0.0.46-nightly.20261006.2735), commit `fd1c3386c4d60f3477ab3f13c87537848de099f5`.
- Local `hermes-fork-patches` follows the maintained remote fork. This assessment worktree contains the four replayed changes and the nightly integration.
- Replayed commits: archived deletion `c2e7bffc24`, shared removal hooks `df94277f63`, stack labels `da64b595ad`, native usage and history `06b5b4fa04`.
- Integrated worktree: `t3/assess-fork-patches-against-nightly` at `b1dd0ab1228530cb681de6e8679189dd1c56f472`.
- Original stale base: `75db86fd9d5cbd7d664fc5f6f05ee4f9928e79d8`. Original work remains preserved through its commits and replayed equivalents.

The maintained remote fork includes the October 5 nightly.
This worktree adopts the October 6 nightly and preserves the fork changes.
The nightly integration is committed locally as `b1dd0ab1228530cb681de6e8679189dd1c56f472`.
No push or live-app installation occurs.
Fixed fork references describe the original differences; nightly references describe the adopted upstream source.
Current source statements describe the integrated worktree and require fresh focused checks.

## Working rules

1. Work on one numbered task at a time.
2. Recheck the target branch and current source before each task.
3. Preserve unique behavior and saved data before removing duplicate code.
4. Run focused checks before marking a task complete.
5. Record the result and verification under that task.

Browser and device checks require George's explicit authorization.
Use focused server, client, contract, and integration checks where the behavior requires them.
Follow repository limits on checks and protect live T3 data.

## Task 01: Make archived-thread deletion use safe cleanup

- [x] Complete implementation and focused verification.

**Decision:** Simplify. **Original patch:** 3.

**Reason:** Keep the deletion policy, but reuse upstream cleanup checks and locks.

**Change:** Keep optional daily deletion of idle archived conversations. Remove the sweep's script execution and forced folder removal. Dispatch the existing deletion command instead. Upstream storage cleanup handles folders under its own settings, workspace lock, and safety checks. Retain the separate removal hook. Check archive state again inside command processing to protect reopened conversations. Protect running turns, background work, queued messages, pending approvals, and pending questions.

**Completion check:** Focused tests protect shared worktrees, active sessions, queued work, terminals, dirty files, and retryable failures. The daily deletion setting remains optional.

**References:** [Fork forced removal](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/orchestration/Layers/ArchivedThreadReaper.ts#L137); [Fork limited active-work check](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/orchestration/Layers/ArchivedThreadReaper.ts#L181); [Native cleanup safeguards](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/storageCleanup.ts#L309); [Current service convention](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/docs/internals/effect-services.md).

**Result:** Original implementation is committed as `0cd4bf4f04`. Its replay is `c2e7bffc24`. Integration moves deletion checks into the native V2 orchestrator. The reaper dispatches guarded deletion; native cleanup owns folder removal. Task 04 supplies the shared hook policy. Fresh integration checks pass; see the integration verification below.

**Verification:** Original pre-integration result: 61 focused tests pass, with targeted lint and the then-current server type check. These checks cover the original stale-base implementation. They do not validate the V2 migration.

**Before installation:** The external installer lies outside this repository. Its current marker requirements remain unverified. Recheck them before installation; this task does not modify that installer.

**Current reassessment:** The recommendation remains valid. The adopted V2 guard checks archive identity, queued and active runs, requests, sessions, background tasks, and child work. Automatic removal retains native clean-file, shared-path, session, terminal, and deletion-effect checks.

## Task 02: Correct stack labels across repositories and environments

- [x] Complete implementation and focused verification.

**Decision:** Refactor. **Original patch:** 16.

**Reason:** Fix mismatched label keys and keep labels within their repository and environment.

**Change:** The fork stores labels under trunk plus branch. The pull request page reads workspace root plus branch. Use native stack membership where available. Use environment, repository, and branch identity for extension labels. Keep mutation scheduling and refresh changes in Task 14.

**Completion check:** Focused tests show correct labels for matching branches in different repositories and environments. Missing stack data produces no incorrect label.

**References:** [Mismatched map key](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/state/gitStacks.ts#L143); [Caller key](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/routes/_chat.pull-requests.tsx#L1952).

**Discussion:** A stack is a sequence of dependent pull requests. A label such as `2/3` shows the second request in a three-request stack. The label producer uses trunk plus branch, while the page reads workspace root plus branch. Those keys do not match. The producer also drops the environment and checkout identity, so repositories or machines can overwrite each other's labels.

**Recommendation:** Use the existing native stack indicator when the pull request supplies membership. Keep the extension label as a fallback. Match that fallback to the environment, repository, and branch. Retain the source checkout when combining results, remove branch-only keys, and request the relevant branch when a root checkout cannot identify its stack. Missing or failed reads show no fallback label. Keep mutation scheduling and refresh changes in Task 14.

**Result:** Original implementation is committed as `eaa612011e`. Its replay is `da64b595ad`. Native membership takes precedence over extension labels. Extension identity includes environment, checkout, host, repository, branch, and pull request. Missing, mismatched, or failed reads show no fallback label. Web and desktop share this route. Mobile selection and mutation scheduling remain outside this task.

**Read sharing:** The server caches stack answers by checkout path and shares pending commands across branch requests. One cache replaces the branch-result cache, so server answers retain one 15-second lifetime. Successful answers include missing-stack results. Failed reads expire immediately. Successful checkout and stack actions clear all cached answers before reading their results. Original pre-integration tests cover concurrent reuse, checkout isolation, expiry, failure recovery, branch matching, and fresh action results. Branch discovery still reads worktree lists and local tracking files.

**Current reassessment:** The adopted native stack API does not replace extension identity or local branch discovery. The correction and shared checkout read cache remain. Original pre-integration result: 165 focused tests, scoped lint, and then-current type checks pass. Fresh integration checks pass. Browser behavior remains unverified.

## Task 03: Stop the duplicate Claude usage probe from scanning transcripts

- [x] Complete implementation and focused verification.

**Decision:** Fix. **Original patch:** 11, 15.

**Reason:** Main skips transcript analysis when it reads account usage. The fork duplicate probe omits that option.

**Change:** Pass skipBehaviors to the remaining Claude usage call. Preserve its timeout and unavailable-API handling. Task 11 can replace this task if it removes the duplicate probe first. Record that replacement before marking this task complete.

**Completion check:** A focused test confirms the probe requests limits without behavior analysis. Signed-out accounts and unavailable APIs retain useful results.

**References:** [Fork duplicate call](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/provider/ClaudeSubscriptionUsage.ts#L244); [Native usage option](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/provider/ClaudeProvider.ts#L369); [Upstream performance correction](https://github.com/pingdotgg/t3code/commit/255ac27d52).

**Result:** The duplicate probe is removed by original commit `2daad75a82`, replayed as `06b5b4fa04`. The adopted native Claude usage call already passes skipBehaviors. Its timeout remains. Original focused tests, scoped TypeScript checks, lint, and formatting pass before integration. Fresh integration checks pass; see the integration verification below.

**Current reassessment:** No duplicate usage collector remains. Keep upstream’s skipBehaviors option; no new transcript-scan patch is needed.

## Task 04: Move archive hooks into a shared worktree service

- [x] Complete implementation and focused verification.

**Decision:** Move. **Original patch:** 1.

**Reason:** Move hook policy from WebSocket handlers into a shared worktree lifecycle service.

**Change:** Keep runOnWorktreeRemove and its failure reporting. Share the removal policy across client requests, automatic cleanup, and aborted setup. Run the hook under the workspace lock after eligibility checks. Repeat automatic safety checks after the hook. Preserve the explicit skip option and the worktree’s own t3.json precedence.

**Completion check:** Focused integration tests exercise client removal and automatic cleanup. Hook failure preserves the checkout. Agent removal and rollback have explicit hook policies.

**References:** [Fork handler policy](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/ws.ts#L3447); [Automatic removal bypass](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/storageCleanup.ts#L390); [Agent rollback](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/mcp/WorktreeMcpService.ts#L289).

**Selected design:** Reuse the existing script runner in one shared removal service. Manual removal and automatic cleanup use that service. Automatic cleanup keeps its ownership, dirty-file, live-work, and workspace-lock checks. Run the script only after eligibility checks pass. Repeat safety checks after the script, because it can run for ten minutes. Keep the folder and report the error when the script fails. Preserve the explicit manual skip option and the worktree's own configuration precedence.

**Rollback decision:** George approves running the removal script after setup starts. Keep the folder and thread if the script fails. Confirm setup process exit before cleanup. Before setup starts, remove only a checkout claimed by this create operation, without running the hook.

**Local integration limit:** The adopted nightly includes native V2 launch and WorktreeMcpService. Manual removal, automatic cleanup, and setup rollback now call the shared policy. Agent-tool rollback before setup uses an explicit hook skip. Fresh V2 tests cover setup retry, cancellation, hook failure, and shutdown failure.

**Result:** Original implementation is committed as `e087994659`. Its replay is `df94277f63`. The integrated WorktreeRemoval service shares hook policy and the workspace lease. Automatic cleanup repeats eligibility after the hook. Setup rollback confirms process exit, retains folders after failures, and records retained ownership. Focused native V2 integration checks pass.

**Verification:** Original pre-integration result: 208 focused tests pass, including seven real Git, script-process, and SQLite cases. Original server type checking and targeted lint pass. These checks do not prove the new V2 launch and agent-tool paths. Native PTY execution and Docker cleanup remain untested.

**Current reassessment:** The recommendation remains valid. Preserve retained-folder reporting and process exit tracking while adopting native setup behavior. A focused retry test confirms shutdown while preserving the existing checkout.

## Task 05: Recognize current and previous managed worktree directories

- [x] Complete implementation and focused verification.

**Decision:** Refactor. **Original patch:** 3, 9.

**Reason:** The adopted nightly supplies configurable worktree roots. Native cleanup already recognizes them; the fork recovery guard still recognizes only the default root.

**Change:** Keep upstream managedWorktreesDirectories and its native cleanup integration. Extend recovery ownership resolution to default, configured, and previous roots. Preserve canonical paths, filesystem-root rejection, and foreign-worktree protection. The helper is already adopted; no backport or further upstream adoption is required.

**Completion check:** Focused tests accept the default, configured, and previous roots. They reject unrelated directories and symlink escapes.

**References:** [Native root helper](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/worktreesDirectory.ts#L29); [Fork fixed root](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/orchestration/Layers/ArchivedThreadReaper.ts#L70); [Fork recovery ownership](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/orchestration-v2/ProviderSessionManager.ts#L1734).

**Result:** Committed locally as `dd109efbc7`. Recovery recognizes default, configured, and previous roots through the native directory helper. Canonical ownership resolves missing segments through the nearest existing ancestor. Filesystem roots, sibling prefixes, dangling links, and symbolic-link escapes fail safely.

**Verification:** Twelve focused integration tests use real Git and persisted recovery notices. They cover all managed locations, foreign paths, nested escapes, submodule policy, saved-thread changes, and failed branches. Changed-file TypeScript checks and scoped lint pass.

**Current reassessment:** This resolution is complete against the adopted nightly. Preserve the behavior described above during later integrations.

## Task 06: Consolidate missing-worktree recovery

- [x] Complete implementation and focused verification.

**Decision:** Consolidate. **Original patch:** 9.

**Reason:** Share one recovery implementation across turn starts and checkpoint rollback.

**Change:** Upstream already recreates a missing worktree before opening the provider session. The fork adds a second restorer in ProviderSessionManager. Share the fork’s ownership guard, user notice, and submodule settings through one helper. Use it from native turn start and checkpoint rollback. Remove the duplicate after verifying initial starts and resumed sessions. Keep the missing-directory error for unrecoverable paths.

**Dependency:** Task 05 extends recovery ownership checks using the root helper already present in this worktree.

**Completion check:** Focused integration tests cover initial starts and resumed sessions. Recovery keeps the saved branch, ownership checks, submodule settings, and user notice. Foreign paths fail safely.

**References:** [Native recovery](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/orchestration-v2/ProviderTurnStartService.ts#L458); [Fork second restorer](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/orchestration-v2/ProviderSessionManager.ts#L1725).

**Result:** Committed locally as `dd109efbc7`. One recovery helper serves native turn starts and checkpoint rollback. The duplicate session-manager restorer is removed. Recovery retains the saved branch and path, project submodule policy, and one persisted notice. It rechecks thread identity and ownership after pruning under the workspace lease.

**Verification:** Eighteen turn-start tests, thirteen rollback tests, and twelve real-Git recovery tests pass. Initial and resumed starts recover before opening the session. Conversation-only rollback retains recovery before session open. Existing file-restore isolation checks remain.

**Current reassessment:** This resolution is complete against the adopted nightly. Preserve the behavior described above during later integrations.

## Task 07: Remove redundant closed-folder machinery

- [x] Complete implementation and focused verification.

**Decision:** Remove. **Original patch:** 6.

**Reason:** Upstream already starts folders closed and preserves expansion during updates.

**Change:** Remove the extra expansion scan, helper, tests, and build marker. The fork calculates open folders on each update, but uses that result only when it resets the initial empty tree.

**Completion check:** Focused file-tree tests cover closed initial folders, preserved expansion after refresh, and explicit expansion controls. Obsolete helpers and markers disappear.

**References:** [Fork extra scan](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/components/files/FileBrowserPanel.tsx#L380); [Upstream closed folders](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/web/src/components/files/FileBrowserPanel.tsx#L265); [Upstream incremental updates](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/web/src/components/files/FileBrowserPanel.tsx#L372).

**Result:** Committed locally as `dd109efbc7`. The redundant expansion scan and its helper are removed. Native initial closed state and incremental updates remain. Explicit expand and collapse controls remain. Obsolete ledger marker claims are removed; the external updater remains unverified.

**Verification:** Seven focused file-tree tests pass. A real FileTree model starts closed, preserves expansion through incremental refresh, and leaves new directories closed. Changed-file TypeScript checks and scoped lint pass.

**Current reassessment:** This resolution is complete against the adopted nightly. Preserve the behavior described above during later integrations.

## Task 08: Reduce the obsolete push-timeout patch

- [x] Complete implementation and focused verification.

**Decision:** Remove. **Original patch:** 7.

**Reason:** Upstream already gives push commands unlimited time. The remaining fork difference adds an error hint.

**Change:** Remove runGitPush and use native unlimited push timeouts. Native Git errors classify selected causes; unknown hook refusals still receive a generic failure. Retain a useful generic pre-push hint through the existing error path if needed. Do not expose raw stderr, which can contain credentials.

**Completion check:** Push retains upstream's unlimited timeout. A rejected pre-push hook still produces useful failure details. Remove tests that prove only the obsolete wrapper.

**References:** [Fork helper](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/vcs/GitVcsDriverCore.ts#L1119); [Upstream push](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/vcs/GitVcsDriverCore.ts#L2281); [Upstream error change](https://github.com/pingdotgg/t3code/commit/f973b1d7d5).

**Result:** Committed locally as `dd109efbc7`. The push wrapper is removed. All five push paths use native runGit with an unlimited timeout. The existing Git failure path supplies the generic pre-push hint. Structured classification remains, and hook output does not enter error messages.

**Verification:** All 133 Git driver tests pass. Coverage includes a slow push beyond the default timeout, real pre-push rejection, safe error details, and structured failure classification. Changed-file TypeScript checks and scoped lint pass.

**Current reassessment:** This resolution is complete against the adopted nightly. Preserve the behavior described above during later integrations.

## Task 09: Consolidate repository skills and commands

- [x] Complete implementation and focused verification.

**Decision:** Consolidate. **Original patch:** 13.

**Reason:** Use upstream workspace snapshots and shared client selectors. Remove the separate prompt RPC and composer merge.

**Change:** Use native workspace discovery for the selected provider instance. Remove the duplicate Claude scanner, prompt RPC, and composer merge. Filter duplicate command names in the shared menu helper. Preserve provider-supported skill and command locations.

**Completion check:** Focused tests cover workspace and instance settings, native precedence, and menu duplicates across clients. Preserve the repository Claude skills link. Do not advertise unsupported files as executable commands.

**References:** [Upstream Claude workspace discovery](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/provider/ClaudeProvider.ts#L429); [Shared selectors](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/packages/client-runtime/src/providerSkills.ts#L122); [Fork cross-provider merge](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/components/chat/ChatComposer.tsx#L2669); [Fork prompt service](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/provider/ProjectPromptsService.ts#L61).

**Result:** Implemented and verified. Included in the repository consolidation commit. The separate Claude discovery service, command scanner, hook, and wire contract are removed. Native provider snapshots supply both composer menus. The shared menu helper filters duplicate names and empty commands. The three repository skills remain; `.claude/skills` links to their single source. Verification: 105 focused tests pass across eight files. Type checks use explicit changed-file roots. Scoped lint and formatting pass; lint reports existing-file warnings. The read-only review finds no concrete regression. Live CLI invocation and browser behavior are not tested.

**Current reassessment:** The old scanner reads names and descriptions; it does not make `.agents/commands` executable. Native Claude dispatch requires commands that its CLI recognizes. No repository command files require migration. Shared user skills and external synchronization remain outside this completed repository change; cleanup scope is unresolved. The inventory finds 26 identical `.agents`/`.claude` skill pairs and 18 pairs with matching instructions but different metadata. Repeated rules also exist under different skill names. The two personal Claude commands are distinct. The identified MCP mirror copies server settings between Claude profiles; it does not generate skills. Preserve cross-provider access before replacing skill copies with links.

## Task 10: Use one branch-naming policy

- [ ] Complete implementation and focused verification.

**Decision:** Consolidate. **Original patch:** 8.

**Reason:** Feed repository configuration into upstream’s project naming rules.

**Change:** Upstream supports project naming mode, prefix, and instructions. Keep the checked-in t3.json prefix if repositories need it. Map it into that policy instead of maintaining two naming policies. Keep thread-named directories and immediate branch following where upstream lacks them. Preserve temporary and legacy branch recognition during conversion.

**Completion check:** Focused tests cover repository-prefix precedence, project settings, temporary branches, legacy branches, and thread-named folders. Branch changes keep thread metadata current.

**References:** [Native naming policy](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/orchestration-v2/ThreadLaunchService.ts#L274); [Fork repository precedence](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/orchestration-v2/ThreadLaunchService.ts#L250); [Fork branch drift service](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/orchestration-v2/WorktreeBranchDrift.ts).

**Result:** Pending.

**Current reassessment:** Native naming mode, prefix, and instructions remain available. The fork still overrides the prefix through t3.json and supplies thread-named directories and branch drift tracking. Keep these unique behaviors while preserving the adopted configurable worktree location.

## Task 11: Replace duplicate subscription reads with native snapshots

- [x] Complete implementation and focused verification.

**Decision:** Consolidate. **Original patch:** 11, 15.

**Reason:** Use native account usage snapshots and refresh. Keep the subscription popover that George selects on October 6.

**Change:** Replace the parallel Claude and Codex probes and their custom usage-read RPC contracts. Native limits already reach web and mobile. Keep the current sidebar popover, disabled-account rows, account selection, usage bars, reset countdowns, and add/manage actions. Use native refresh and usage helpers. Keep the header's total remaining allowance as a display calculation, counting each account once. Preserve the existing activeSubscriptionInstanceId setting and selection behavior. No saved-setting conversion is needed. This task changes usage collection, not mobile selection policy.

**Dependency:** Task 12 completes native history capture with this change. That migration is present; no duplicate probe source is required.

**Completion check:** Focused tests cover native Claude and Codex readings, account deduplication, refresh, unavailable accounts, disabled rows, and environment switching. Existing saved selection and account privacy behavior remain valid. Web and desktop use the same popover. Mobile continues to use native readings.

**References:** [Fork duplicate service](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/provider/SubscriptionUsageService.ts#L253); [Upstream Claude usage](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/provider/ClaudeProvider.ts#L369); [Upstream usage helpers](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/packages/shared/src/usageLimits.ts#L190); [Native pooled limits](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/web/src/components/usage/UsageLimitsPooled.tsx).

**Result:** Original implementation is committed as `2daad75a82`, replayed as `06b5b4fa04`. The popover reads native snapshots and uses native refresh sharing. Duplicate probes, usage service, usage-read RPC methods, and client query/command are removed. Selection settings remain unchanged. Original focused checks pass before integration. Fresh integration checks pass; see the integration verification below.

**Current reassessment:** The adopted nightly confirms native Claude and Codex limits. Keep the chosen popover, disabled rows, selection, refresh, and account-deduplicated total. Mobile continues to use native readings; this task does not change mobile selection policy.

## Task 12: Move subscription history onto native usage windows

- [x] Complete implementation and focused verification.

**Decision:** Move. **Original patch:** 12.

**Reason:** Keep the unique history feature, including the popover's weekly history strip. Record native usage snapshots without separate provider probes. Earlier records remain separate because they lack account identity.

**Change:** Upstream token-cost history does not replace closed-window peaks or ran-out counts. Remove this feature’s dependence on duplicate probes. Use native window IDs instead of two fixed window slots. Identify new records by account, window, and reset time. Preserve existing JSON records as unattributed history under Earlier labels. Serialize atomic writes and preserve malformed files. Keep derivation in shared code and retain the popover strip. New records require a reported account address.

**Dependency:** Task 11 supplies the native snapshots. History capture now uses them, so the old probe loop can remain removed.

**Completion check:** Focused tests convert existing records and separate account identities. Closed windows retain their peaks and ran-out counts. Shared derivation supports web and mobile.

**References:** [Fork history store](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/provider/SubscriptionUsageHistoryStore.ts); [Fork fixed-window history](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/packages/shared/src/subscriptionUsageHistory.ts#L27); [Native usage windows](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/packages/contracts/src/providerUsageLimits.ts); [Fork web history](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/components/subscriptions/SubscriptionHistory.tsx).

**Result:** Original implementation is committed as `2daad75a82`, replayed as `06b5b4fa04`. Native snapshot changes feed serialized atomic history writes. New records separate account and native window identities. Earlier records remain separately visible. Missing account addresses skip new recording. Original persistence, failure, startup, retention, and mounted-popover checks pass before integration. Fresh integration checks pass; see the integration verification below.

**Current reassessment:** Native token-cost history still does not replace closed-window peaks or ran-out counts. Retain the independent history store and shared derivation. Existing unattributed JSON records stay separate from current account records.

## Task 13: Consolidate native and extension stack presentation

- [ ] Complete implementation and focused verification.

**Decision:** Consolidate. **Original patch:** 16.

**Reason:** Use native stack membership and UI. Retain the gh-stack adapter for local operations.

**Change:** Upstream has host-native stacks, layer lists, popovers, and menus. The fork displays a second chain card beside them. Share presentation for native stacks. Retain local and unpublished branches, submit, sync, and checkout through GhStackCli. Extension chains and native stack IDs describe different systems. Keep upstream expected-commit checks for merge actions.

**Dependency:** Use the corrected identities from Task 02. Keep extension mutation behavior available for Task 14.

**Completion check:** Native stacks use upstream membership and merge protections. Local and unpublished branches retain submit, sync, and checkout. Extension chains do not become native stack IDs.

**References:** [Fork duplicate presentation](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx#L730); [Native stack API](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/pullRequest/GitHubPullRequestCli.ts#L2231); [Native stack presentation](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/web/src/components/pullRequest/PullRequestStackLayers.tsx); [Retained extension adapter](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/git/stack/GhStackCli.ts).

**Result:** Pending.

**Current reassessment:** Native stack layers, menus, and host membership remain available. The fork chain card remains separate. Share presentation while retaining local and unpublished extension branches and their commands. Preserve native expected-commit checks; extension chains do not become native stack IDs.

## Task 14: Coordinate stack mutations and refresh on the server

- [ ] Complete implementation and focused verification.

**Decision:** Refactor. **Original patch:** 16.

**Reason:** Coordinate ordinary VCS mutations and extension stack mutations on the server. Task 02 already corrects label identity.

**Change:** The fork’s client stack scheduler remains separate from ordinary VCS commands and cannot coordinate other clients. No shared native server mutation coordinator covers both paths. Use a small shared KeyedLock keyed by repository identity across ordinary and extension mutations. Refresh the affected checkout, stack, and pull request state together. Consume the returned refreshed view. Pass the branch to mobile discovery.

**Dependency:** Task 13 defines retained extension actions. Task 02 supplies label identity.

**Completion check:** Focused integration tests prevent conflicting mutations from separate clients. Actions refresh the checkout that runs the command. Mobile discovers the requested branch from another checkout.

**References:** [Mismatched map key](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/state/gitStacks.ts#L143); [Caller key](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/routes/_chat.pull-requests.tsx#L1952); [Independent client scheduler](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/packages/client-runtime/src/state/gitStacks.ts#L22).

**Result:** Pending.

**Current reassessment:** Task 02 shares reads and clears cached stack answers after successful actions. It does not serialize mutations across clients. This task requires a shared server lock using the existing primitive, not an assumed native repository scheduler.

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

## Task 17: Retain and verify the configurable idle timeout

- [x] Complete implementation and focused verification.

**Decision:** Keep. **Original patch:** 10.

**Reason:** Upstream still uses a fixed idle timeout. Keep the setting and existing busy-session safeguards.

**Change:** The fork reads providerSessionIdleTimeout in the V2 session manager. Keep that integration. Add focused V2 behavior coverage when editing it; the old reaper tests no longer prove this path. Keep the meaning of zero as disabled.

**Completion check:** Focused V2 tests cover changed timeout settings, zero as disabled, and protection for active turns and background work. Existing settings survive reload.

**References:** [Fork dynamic timeout](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/orchestration-v2/ProviderSessionManager.ts#L402); [Native fixed timeout](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/orchestration-v2/ProviderSessionManager.ts#L403).

**Result:** Committed locally as `dd109efbc7`. The configurable V2 timeout remains. A new check rereads settings after a delayed provider background-work probe. A timeout disabled or extended during that probe cannot trigger release using its old value. Zero, busy-session protection, replacement protection, and the maximum background pin duration remain.

**Verification:** All fifty V2 session-manager tests pass. Five new cases cover shorter and longer settings, disabling and re-enabling release, and both settings races during a delayed probe. The two race tests fail before the fix and pass afterward. Settings reload coverage also passes.

**Current reassessment:** This resolution is complete against the adopted nightly. Preserve the behavior described above during later integrations.

## Task 18: Retain and consolidate atomic settings corrections

- [x] Complete implementation and focused verification.

**Decision:** Keep. **Original patch:** 14.

**Reason:** Keep the plain-record guard and Duration preservation. Native atomic writes already propagate failures.

**Change:** Native default stripping protects a fixed atomic field list, including its refresh Duration fields. The fork additionally protects class values from recursive stripping and preserves providerSessionIdleTimeout during shared merging. Keep those corrections. Native writes already fail before reporting success; fork logging adds diagnosis. Consolidate only the remaining settings difference.

**Completion check:** Focused tests preserve Duration values, atomic settings, defaults, and persisted round trips. Failed writes do not report success.

**References:** [Fork class-value guard](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/serverSettings.ts#L520); [Native fixed field list](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/serverSettings.ts#L483); [Shared Duration preservation](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/packages/shared/src/serverSettings.ts#L274).

**Result:** Committed locally as `dd109efbc7`. The existing generic class-value guard and shared Duration preservation remain. No production rewrite is required. The persisted round-trip test now reloads settings through a fresh service after an unrelated save.

**Verification:** Sixty-three server settings tests and thirty-six shared settings tests pass. They cover persisted Duration values, sparse updates, failed writes, unchanged cache after failure, and useful error logging. Changed-file TypeScript checks and scoped lint pass.

**Current reassessment:** This resolution is complete against the adopted nightly. Preserve the behavior described above during later integrations.

## Task 19: Retain stale Claude query invalidation

- [x] Complete implementation and focused verification.

**Decision:** Keep. **Original patch:** 3 related.

**Reason:** Keep stale-query invalidation after authentication failure.

**Change:** Upstream classifies failed results but does not close this stale query. Keep the fork’s close behavior. Prefer structured authentication status where available. Retain text matching as a fallback.

**Completion check:** Focused tests close an expired query without closing a replacement query. Authentication failures retain a useful message and allow later recovery.

**References:** [Fork invalidation](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L6509); [Native result handling](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L6430).

**Result:** Committed locally as `dd109efbc7`. The existing structured authentication handling and identity-checked Claude query closure remain. No production rewrite is required. The test harness gives replacement queries separate queues.

**Verification:** All 144 Claude adapter tests pass. A new receipt-based test holds expired-query closure, starts a replacement, completes old closure, sends stale authentication frames, and completes the replacement. Only the expired query closes.

**Current reassessment:** This resolution is complete against the adopted nightly. Preserve the behavior described above during later integrations.

## Task 20: Share browser title and sidebar attention rules

- [x] Complete implementation and focused verification.

**Decision:** Keep. **Original patch:** Additional.

**Reason:** Upstream has no equivalent browser title counter.

**Change:** Keep completion, approval, input, and plan counts. Share attention rules with the sidebar. The fork title currently excludes every pending background task; native sidebar rules allow long-running command tasks after agent completion. Use the same task-kind predicate so command tasks do not suppress only the title count. Preserve V2 run state and authoritative server visit timestamps.

**Completion check:** Focused tests cover unseen completions, approvals, input requests, plans, archived threads, settled threads, and server visit timestamps across environments.

**References:** [Maintained title logic](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/documentTitle.ts#L10); [Native title sync](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/apps/web/src/routes/__root.tsx#L337).

**Result:** Committed locally as `dd109efbc7`. The title uses the native background-work predicate shared with the sidebar. Background commands allow unseen completion and ready-plan counts. Monitors, child agents, and other background tasks hold those counts. Approvals and input requests retain priority. Server visit timestamps remain authoritative across environments.

**Verification:** All twenty-two title tests pass. They cover task kinds, plans, requests, archived and settled threads, environment identity, and conflicting server and local visit timestamps. Web and desktop share this code. Browser rendering remains unverified.

**Current reassessment:** This resolution is complete against the adopted nightly. Preserve the behavior described above during later integrations.

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

**Reason:** Revalidate version-specific build changes. Shorten the patch ledger to the remaining delta.

**Change:** The adopted catalog uses Vite+ 1.0.0 and Effect 4.0.1. Recheck the fork’s vite config import against native vite-plus. Validate the raw heic-to/csp decoder URL and optional import under production CSP. CSP is the browser’s content security policy. Validate the compiler filter against current chunk paths. Retain warning-limit and timing changes only with measurements. Task 23 updates the ledger and maintenance records.

**Completion check:** A scoped production build confirms decoder loading, optional code loading, and compiler coverage. Record measurements before retaining diagnostic suppressions.

**References:** [Fork build changes](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/vite.config.ts#L173); [Fork decoder import](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/lib/imageCompression.ts#L14); [Current dependency catalog](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/pnpm-workspace.yaml#L49); [Stale patch ledger](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/PATCHES.md#L156).

**Result:** Pending.

**Current reassessment:** The current fork still imports defineConfig from vite, while the adopted native file imports it from vite-plus. The HEIC decoder remains a raw URL import. Source inspection alone does not prove build compatibility, decoder loading, or compiler coverage.

## Task 23: Rewrite the patch ledger and remove resolved maintenance records

- [x] Complete implementation and focused verification.

**Decision:** Recheck. **Original patch:** Maintenance.

**Reason:** The patch ledger still contains obsolete feature claims and old toolchain versions. Rewrite it around the remaining upstream difference.

**Change:** Rewrite stale PATCHES.md claims about HTTP copying, ignored trees, naming, usage, and recovery. Document only the remaining upstream delta. Combine duplicate papercuts and remove records whose causes have fixes. Replace obsolete build-marker requirements with focused behavior checks. Record retained features and removed patches without copying implementation details.

**Dependency:** Update the ledger after each later feature change. Current completed and pending decisions are reconciled now.

**Completion check:** Patch records match the completed tasks and current source. Remaining markers identify retained behavior. Unresolved papercuts retain their evidence.

**References:** [Fork build changes](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/vite.config.ts#L173); [Fork decoder import](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/apps/web/src/lib/imageCompression.ts#L14); [Current dependency catalog](https://github.com/pingdotgg/t3code/blob/fd1c3386c4d60f3477ab3f13c87537848de099f5/pnpm-workspace.yaml#L49); [Stale patch ledger](https://github.com/georgejabbour/t3code/blob/20d0dbcbc52e82bce0fb15fd2e4dac0ef0235618/PATCHES.md#L156).

**Result:** Committed locally as `dd109efbc7`. PATCHES.md now describes the current difference from the adopted October 6 nightly. It records retained behavior and pending consolidation decisions. Three maintenance records are removed because their causes have fixes. Other records remain. Unverified external updater and marker claims are corrected.

**Verification:** Source review confirms the removed records concern obsolete reaper removal spans, replaced Bun snapshot guidance, and a removed Vite dependency patch. Ledger links resolve, formatting passes, and independent review finds no remaining actionable issue. Later feature changes must update the ledger again.

**Current reassessment:** This resolution is complete against the adopted nightly. Preserve the behavior described above during later integrations.

## Already absorbed upstream

The maintained fork delta no longer includes the phone steering patch or the extra composer attachment button.
Keep those removals when updating the branch.
The refreshed worktree preserves the maintained fork’s removals.

## Integration verification

The refreshed revision passes 663 focused tests across 22 files. Server and web checks use explicit changed-file TypeScript roots. Scoped lint and formatting pass. Lint retains existing warnings. No full repository or package type check runs.

1. Archived deletion passes six sweep tests and nine SQLite control-read tests. Checks cover archive identity, queued work, late background items, and persisted watches. The guard reuses native background-work derivation. Manual deletion retains its native behavior.
2. Worktree lifecycle checks pass 49 V2 launch tests, 50 agent-tool tests, 91 terminal tests, five shared-removal integration tests, and eight automatic-cleanup integration tests. Real Git, script processes, and SQLite confirm hook failures retain folders. Post-hook dirty files, shared folders, live sessions, configured roots, and previous roots retain their protections. Cleanup reads the native archived-thread list correctly.
3. Stack and usage checks pass 172 client tests and 77 server tests. They cover popover selection, native refresh, account identity, history persistence, stack reads, script policy, and cleanup eligibility. The selected popover remains.
4. Settings and Git checks pass 63 settings tests and 133 Git tests. Integration corrects renamed test helpers. One native Git fixture now sets the actual executable permission before comparing working-tree changes.

These checks use mocked provider processes, project snapshots, and terminal metadata where isolation requires them. Deleted-thread cleanup and deletion-effect queues do not have new real-boundary integration coverage. Browser, mobile, native PTY, Docker, and production decoder behavior remain unverified.

## Assessment limits

The reassessment uses fixed upstream references and the integrated working source.
Pending feature assessments do not provide runtime proof. The integration checks provide focused behavior proof.
Original check results describe the earlier implementation, before replay and V2 integration.
Fresh checks cover the integration changes. Pending feature recommendations remain source assessments.
Browser, native PTY, Docker, production decoder, and mobile behavior remain unverified.
Recheck current source before changing a pending feature.

## Verification of the confident resolutions

The nine selected resolutions are committed locally as `dd109efbc7`.
No push, installation, browser check, or live-data write occurs.

- 498 focused tests pass across eleven files in the server, web client, and shared package.
- Recovery checks use real Git, local submodules, and persisted notices.
- TypeScript checks use explicit changed-file roots. No repository-wide or package-wide TypeScript check runs.
- Scoped lint and formatting pass. Six existing lint warnings remain in unchanged logic.
- Independent source reviews find no remaining actionable issue.

Tasks 09, 10, 13, 14, 15, 16, 21, and 22 remain pending.
The external updater remains unverified. Browser-specific behavior remains unverified.
