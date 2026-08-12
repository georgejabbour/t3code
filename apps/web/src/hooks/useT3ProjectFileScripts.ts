import {
  EnvironmentId,
  T3_PROJECT_FILE_NAME,
  type T3ProjectFile,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

// React runs every hook on every render, so a caller without an environment
// still has to call the query hook. This stands in for the missing id while
// the `enabled` flag keeps the query from running. An environment id may not
// be empty, so this carries a name no real environment takes.
const NO_ENVIRONMENT_ID = EnvironmentId.make("t3code:no-environment");

export interface T3ProjectFileState {
  /**
   * - `valid`: t3.json exists and decoded.
   * - `invalid`: t3.json exists but fails to decode (the server then ignores
   *   the whole file, including `iconPath` and every script).
   * - `missing`: no readable t3.json at the workspace root.
   * - `loading`: the file query has not settled yet.
   */
  status: "loading" | "missing" | "invalid" | "valid";
  /** The decoded file when status is `valid`, null otherwise. */
  file: T3ProjectFile | null;
  scripts: ReadonlyArray<T3ProjectFileScript>;
}

/**
 * Decoded state of the project's checked-in `t3.json`, including whether the
 * file exists but is broken — which the runtime otherwise swallows silently.
 */
export function useT3ProjectFileState(
  environmentId: EnvironmentId | null,
  cwd: string | null,
): T3ProjectFileState {
  const query = useProjectFileQuery(
    environmentId ?? NO_ENVIRONMENT_ID,
    cwd ?? "",
    T3_PROJECT_FILE_NAME,
    cwd !== null && environmentId !== null,
  );
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  return useMemo(() => {
    if (contents === null) {
      return {
        status: isPending ? "loading" : "missing",
        file: null,
        scripts: NO_SCRIPTS,
      } as const;
    }
    const file = parseT3ProjectFile(contents);
    if (file === null) {
      return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
    }
    return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
  }, [contents, isPending]);
}

/**
 * Scripts declared in the project's checked-in `t3.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useT3ProjectFileScripts(
  environmentId: EnvironmentId | null,
  cwd: string | null,
): ReadonlyArray<T3ProjectFileScript> {
  return useT3ProjectFileState(environmentId, cwd).scripts;
}

/**
 * The branch prefix the project declares in its checked-in `t3.json`.
 *
 * Null means the project declares none, and the caller then uses T3 Code's
 * default prefix.
 */
export function useT3ProjectFileBranchPrefix(
  environmentId: EnvironmentId | null,
  cwd: string | null,
): string | null {
  return useT3ProjectFileState(environmentId, cwd).file?.branchPrefix ?? null;
}
