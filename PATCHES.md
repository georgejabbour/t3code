# Fork differences

This ledger compares the fork with `fd1c3386c4d60f3477ab3f13c87537848de099f5`.
That commit supplies `v0.0.46-nightly.20261006.2735`.
The assessment worktree includes the maintained remote fork, four replayed changes, and the October 6 nightly integration.

Retain each difference only while it supplies required behavior that upstream lacks.
Remove a duplicate when focused behavior checks prove that upstream supplies the same behavior.
The external updater and its marker requirements remain unverified.
Use repository checks for behavior; marker strings alone cannot prove correctness.

## Cleanup and recovery

The fork adds `runOnWorktreeRemove` to project scripts.
[WorktreeRemoval](apps/server/src/project/WorktreeRemoval.ts) shares that policy across manual removal, automatic cleanup, and setup rollback.
The workspace lease coordinates removal and startup.
Hook failure preserves the checkout. Setup rollback also requires confirmed setup process exit.
Rollback before setup starts explicitly skips the hook.

Optional daily archived-history deletion uses guarded native V2 deletion commands.
[ArchivedThreadReaper](apps/server/src/orchestration/Layers/ArchivedThreadReaper.ts) selects eligible archived threads.
The V2 orchestrator checks archive identity and live work again before deletion.
Native storage cleanup owns folder removal and retains its dirty-file, shared-workspace, session, and terminal checks.
Automatic cleanup repeats its checks after a removal hook runs.

Upstream already recreates missing worktrees during turn start and supplies configurable managed directories.
[WorktreeRecovery](apps/server/src/orchestration-v2/WorktreeRecovery.ts) consolidates recovery for turn starts and checkpoint rollback.
The fork adds canonical ownership checks, configured and previous root support, project submodule policy, and a recovery notice.
Recovery uses the saved branch and path. It does not move threads when the configured root changes.
It rejects filesystem roots, foreign paths, dangling links, and symbolic-link escapes.
It checks the saved thread again after Git pruning. Unrecoverable paths retain the provider's missing-directory error.

## Provider reliability

Upstream uses a fixed provider session idle timeout.
The fork exposes `providerSessionIdleTimeout` and reads it in the V2 session manager.
Zero disables idle release. Idle timers recheck settings at five-minute intervals or sooner.
Provider probes can delay a check. The manager reads settings again before release.
A delayed provider probe cannot release a session using a timeout that the user disables or extends during that probe.
Native busy-session, generation, replacement-session, and background-work safeguards remain.
Background work retains the existing maximum idle pin duration.

Native settings already write atomically and propagate persistence failures.
The fork protects class values from recursive default stripping and preserves the idle-timeout Duration during settings merging.
A Duration is the typed time interval used by Effect.
Unrelated updates preserve it, and a fresh settings service reloads the saved value.
The fork retains useful persistence error logging.

The fork invalidates a Claude query after an authentication failure and closes only that query.
Identity checks protect replacement queries from stale results and delayed closure.
Structured authentication status takes precedence; text matching remains a fallback.

## Subscription interface

The fork retains the sidebar subscription popover, manual subscription selection, and quota history.
Native provider snapshots supply usage readings.
The duplicate Claude and Codex usage collectors, account-use cache, and separate usage refresh RPC are removed.
Native Claude usage reads already skip transcript behavior analysis.

[SubscriptionUsageHistoryStore](apps/server/src/provider/SubscriptionUsageHistoryStore.ts) records native quota windows.
History stores window peaks and retains account separation and reset handling.
A failed refresh does not overwrite a valid reading with invented usage.

## Client preferences

The fork adds a browser title attention count.
It shares native background-work completion rules with the sidebar.
Approvals and input requests require attention immediately.
A background command does not hold the completion count; monitors, child agents, and other background tasks do.
Ready plans and unseen completions retain environment identity and authoritative server visit timestamps.
Web and desktop share this client code.

Native folders already start closed and preserve expansion through incremental tree updates.
The extra expansion scan is removed. Explicit expand and collapse controls remain.

The remaining client differences include additional fonts, ignored-file preferences and search, clipboard refinements.
Upstream already supplies physical directory browsing, HTTP clipboard fallback, workspace command discovery, and project naming settings.
Further consolidation of these differences remains pending.
Preserve rich clipboard formats and iOS selection behavior until their replacements are verified.
Checked-in branch prefixes feed the native project naming policy.
The server owns temporary naming, including mobile requests and namespace collision checks.
Thread-named directories and immediate branch tracking remain.
Skills and commands use native discovery for the selected provider instance and workspace.
The separate Claude scanner, prompt RPC, and cross-provider composer merge are removed.
Shared menu filtering removes duplicate command names and preserves native precedence.
The repository Claude skills link remains because Claude uses that supported path.

## Git and build extensions

Stacks use upstream membership, navigation, badges, and merge protections.
The fork's `gh-stack` services, RPC methods, caches, and interface controls are removed.
Local and unpublished stack controls no longer appear in the application.
Existing branches, worktrees, and extension tracking files remain unchanged.

Native Git pushes already have unlimited time to complete.
The redundant push wrapper is removed.
The existing Git error path retains a generic pre-push-hook hint without exposing raw hook output.
Native structured Git failure classification remains.

The adopted toolchain uses Effect 4.0.1 and Vite+ 1.0.0.
The remaining web build and asset changes need separate assessment.
Old Vite watcher patch and closed-folder marker requirements no longer describe repository changes.
Unresolved maintenance records remain in `.papercuts`; remove a record only when its cause has a proven fix.
