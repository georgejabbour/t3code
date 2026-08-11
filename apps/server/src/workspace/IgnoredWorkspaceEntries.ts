import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ProjectEntry, ProjectEntryKind, ProjectListEntriesResult } from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import {
  type RankedSearchResult,
  insertRankedSearchResult,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";

import * as VcsProcess from "../vcs/VcsProcess.ts";

/**
 * Folders that stay out of the file explorer even when the caller asks for the
 * files git ignores. A `node_modules` folder holds tens of thousands of files.
 * On this repository the full ignored list is 230,000 paths, and 228,000 of
 * them sit under `node_modules`. Removing these two names takes that list to
 * about 1,600 paths, which fits the entry cap with room to spare.
 */
export const ALWAYS_HIDDEN_PATH_SEGMENTS = [".git", "node_modules"] as const;

/** Cap on the ignored paths one workspace contributes. */
export const IGNORED_ENTRY_LIMIT = 5_000;

const IGNORED_CACHE_TTL_NANOS = 60_000_000_000n;
const IGNORED_GIT_TIMEOUT_MS = 10_000;
const IGNORED_GIT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

const EMPTY_RESULT: ProjectListEntriesResult = { entries: [], truncated: false };

// Copied from GitVcsDriver. A file-system monitor or an untracked-file cache
// can answer from stale state, and this command must read the disk as it is
// now.
const GIT_HARDENED_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
] as const;

export class IgnoredWorkspaceEntries extends Context.Service<
  IgnoredWorkspaceEntries,
  {
    /**
     * Lists the paths in this workspace that git ignores.
     *
     * This never fails. A folder outside git, a missing git, a timeout and a
     * broken repository all produce an empty list, so the file explorer keeps
     * working in every one of those cases.
     */
    readonly list: (normalizedCwd: string) => Effect.Effect<ProjectListEntriesResult>;
    readonly invalidate: (normalizedCwd: string) => Effect.Effect<void>;
  }
>()("t3/workspace/IgnoredWorkspaceEntries") {}

interface IgnoredCacheEntry {
  readonly result: ProjectListEntriesResult;
  readonly expiresAtNanos: bigint;
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  return separatorIndex === -1 ? undefined : input.slice(0, separatorIndex);
}

function holdsAlwaysHiddenSegment(path: string): boolean {
  const segments = path.split("/");
  return segments.some((segment) =>
    (ALWAYS_HIDDEN_PATH_SEGMENTS as ReadonlyArray<string>).includes(segment),
  );
}

/** Builds the pathspecs that keep the always-hidden folders out of git's answer. */
export function buildAlwaysHiddenPathspecs(): string[] {
  return ALWAYS_HIDDEN_PATH_SEGMENTS.flatMap((segment) => [
    `:(exclude,glob)${segment}/**`,
    `:(exclude,glob)**/${segment}/**`,
  ]);
}

/**
 * Splits git's NUL-separated output. A truncated read can end mid-path, so the
 * last fragment goes away when the output was cut. Copied from GitVcsDriver.
 */
function splitNullSeparatedPaths(input: string, truncated: boolean): string[] {
  const parts = input.split("\0");
  if (parts.length === 0) return [];
  if (truncated && parts[parts.length - 1]?.length) {
    parts.pop();
  }
  return parts.filter((value) => value.length > 0);
}

/**
 * Turns git's file paths into entries the file explorer can draw.
 *
 * Git reports files only. A tree also needs a row for each folder along the
 * way, so this adds every parent folder that no entry covers yet.
 */
export function toIgnoredEntries(
  paths: ReadonlyArray<string>,
  truncated: boolean,
  limit: number,
): ProjectListEntriesResult {
  const entryByPath = new Map<string, ProjectEntry>();
  // Collected separately: the ancestor pass below writes into the same map, and
  // iterating a map while it grows would revisit the rows that pass just added.
  const filePaths: string[] = [];
  for (const rawPath of paths) {
    const path = rawPath.replaceAll("\\", "/").replace(/\/+$/, "");
    if (!path || path.startsWith("/") || path.split("/").includes("..")) continue;
    if (holdsAlwaysHiddenSegment(path)) continue;
    if (entryByPath.has(path)) continue;
    entryByPath.set(path, { path, kind: "file" });
    filePaths.push(path);
  }
  for (const path of filePaths) {
    let parentPath = parentPathOf(path);
    while (parentPath) {
      if (!entryByPath.has(parentPath)) {
        entryByPath.set(parentPath, { path: parentPath, kind: "directory" });
      }
      parentPath = parentPathOf(parentPath);
    }
  }
  const sorted = [...entryByPath.values()].toSorted((left, right) =>
    left.path.localeCompare(right.path),
  );
  const entries = sorted.slice(0, limit);
  return { entries, truncated: truncated || entries.length < sorted.length };
}

/**
 * Joins the index result with the ignored result.
 *
 * The index wins on a path both lists hold, because the index knows whether a
 * path is a file or a folder from the real directory entry.
 */
export function mergeIgnoredEntries(
  base: ProjectListEntriesResult,
  ignored: ProjectListEntriesResult,
  limit: number,
): ProjectListEntriesResult {
  if (ignored.entries.length === 0) {
    return ignored.truncated && !base.truncated ? { ...base, truncated: true } : base;
  }
  const entryByPath = new Map<string, ProjectEntry>();
  for (const entry of ignored.entries) entryByPath.set(entry.path, entry);
  for (const entry of base.entries) entryByPath.set(entry.path, entry);
  const sorted = [...entryByPath.values()].toSorted((left, right) =>
    left.path.localeCompare(right.path),
  );
  const entries = sorted.slice(0, limit);
  return {
    entries,
    truncated: base.truncated || ignored.truncated || entries.length < sorted.length,
  };
}

/**
 * Ranks ignored paths against one search query.
 *
 * The caller puts these results after the index results. The native index
 * returns no score, so the two lists cannot interleave by rank.
 */
export function rankIgnoredEntries(
  ignored: ReadonlyArray<ProjectEntry>,
  normalizedQuery: string,
  limit: number,
  filter: {
    readonly kind?: ProjectEntryKind | undefined;
    readonly imageOnly?: boolean | undefined;
    readonly excludePaths?: ReadonlySet<string> | undefined;
  } = {},
): ProjectEntry[] {
  if (limit <= 0) return [];
  const ranked: RankedSearchResult<ProjectEntry>[] = [];
  const matches: ProjectEntry[] = [];
  for (const entry of ignored) {
    if (filter.kind !== undefined && entry.kind !== filter.kind) continue;
    if (filter.imageOnly === true && !isWorkspaceImagePreviewPath(entry.path)) continue;
    if (filter.excludePaths?.has(entry.path)) continue;
    if (!normalizedQuery) {
      // An empty query is a bounded browse, so path order is the only order
      // available. The list already arrives sorted.
      if (matches.length < limit) matches.push(entry);
      continue;
    }
    const value = entry.path.toLowerCase();
    const score =
      scoreQueryMatch({
        value: value.slice(value.lastIndexOf("/") + 1),
        query: normalizedQuery,
        exactBase: 0,
        prefixBase: 2,
        boundaryBase: 4,
        includesBase: 6,
        fuzzyBase: 40,
      }) ??
      scoreQueryMatch({
        value,
        query: normalizedQuery,
        exactBase: 10,
        prefixBase: 12,
        boundaryBase: 14,
        includesBase: 16,
        fuzzyBase: 60,
      });
    if (score === null) continue;
    insertRankedSearchResult(ranked, { item: entry, score, tieBreaker: entry.path }, limit);
  }
  return normalizedQuery ? ranked.map((candidate) => candidate.item) : matches;
}

export const make = Effect.gen(function* () {
  const vcsProcess = yield* VcsProcess.VcsProcess;
  const cache = new Map<string, IgnoredCacheEntry>();

  const runGit = Effect.fn("IgnoredWorkspaceEntries.runGit")(function* (normalizedCwd: string) {
    const result = yield* vcsProcess.run({
      // This string is the fork's build marker for this patch. It reaches the
      // bundle as a literal, so a build that lost the patch loses the marker.
      operation: "IgnoredWorkspaceEntries.listIgnoredPaths",
      command: "git",
      args: [
        ...GIT_HARDENED_CONFIG_ARGS,
        "ls-files",
        // --others finds ignored files git does not track. --cached finds
        // tracked files that a later ignore rule now also matches.
        "--cached",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
        "--",
        ...buildAlwaysHiddenPathspecs(),
      ],
      cwd: normalizedCwd,
      allowNonZeroExit: true,
      timeoutMs: IGNORED_GIT_TIMEOUT_MS,
      maxOutputBytes: IGNORED_GIT_MAX_OUTPUT_BYTES,
      appendTruncationMarker: false,
    });
    if (result.exitCode !== 0) {
      // A folder outside a git repository exits 128 here. That is ordinary,
      // not a fault, so this stays at debug level.
      yield* Effect.logDebug("git ls-files reported no ignored paths", {
        cwd: normalizedCwd,
        exitCode: result.exitCode,
      });
      return EMPTY_RESULT;
    }
    return toIgnoredEntries(
      splitNullSeparatedPaths(result.stdout, result.stdoutTruncated),
      result.stdoutTruncated,
      IGNORED_ENTRY_LIMIT,
    );
  });

  const list: IgnoredWorkspaceEntries["Service"]["list"] = Effect.fn(
    "IgnoredWorkspaceEntries.list",
  )(function* (normalizedCwd) {
    const nowNanos = yield* Clock.currentTimeNanos;
    const cached = cache.get(normalizedCwd);
    if (cached && cached.expiresAtNanos > nowNanos) {
      return cached.result;
    }
    // Every failure mode ends as an empty list. The file explorer must not
    // break because git is absent, slow, or pointed at a plain folder.
    const result = yield* runGit(normalizedCwd).pipe(
      Effect.catchCause((cause) =>
        Effect.logDebug("Failed to list ignored workspace paths", {
          cwd: normalizedCwd,
          cause,
        }).pipe(Effect.as(EMPTY_RESULT)),
      ),
    );
    // Store on success only. An interrupted run must not poison the cache the
    // way a memoized Exit would.
    cache.set(normalizedCwd, {
      result,
      expiresAtNanos: nowNanos + IGNORED_CACHE_TTL_NANOS,
    });
    return result;
  });

  const invalidate: IgnoredWorkspaceEntries["Service"]["invalidate"] = (normalizedCwd) =>
    Effect.sync(() => {
      cache.delete(normalizedCwd);
    });

  return IgnoredWorkspaceEntries.of({ list, invalidate });
});

export const layer = Layer.effect(IgnoredWorkspaceEntries, make).pipe(
  Layer.provide(VcsProcess.layer),
);
