import {
  EnvironmentId,
  T3_PROJECT_FILE_NAME,
  type T3ProjectFile,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

// React runs every hook on every render, so a caller without an environment
// still has to call the query hook. This stands in for the missing id while
// the `enabled` flag keeps the query from running. An environment id may not
// be empty, so this carries a name no real environment takes.
const NO_ENVIRONMENT_ID = EnvironmentId.make("t3code:no-environment");

export interface T3ProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: T3ProjectFile | null;
  scripts: ReadonlyArray<T3ProjectFileScript>;
}

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
}

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
