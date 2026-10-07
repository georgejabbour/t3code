# Fork consolidation TODO

Assessment date: 2026-10-06. One task remains after adoption of the October 6 nightly.
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
