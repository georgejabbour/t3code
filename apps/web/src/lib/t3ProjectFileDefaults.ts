import {
  T3_PROJECT_FILE_NAME,
  type EnvironmentId,
  type T3ProjectFile,
  type ThreadEnvMode,
} from "@t3tools/contracts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

/**
 * Read and parse the project's checked-in `t3.json`.
 *
 * Imperative counterpart to `useT3ProjectFileScripts` for the new-thread
 * path, which resolves defaults at call time rather than render time. The
 * file query atom caches per (environment, cwd), so repeat calls don't
 * re-fetch. Optimistic in-app writes overlay the query result, matching what
 * `useProjectFileQuery` renders. Missing, truncated, or invalid files
 * resolve to null.
 */
async function readT3ProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<T3ProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, T3_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    T3_PROJECT_FILE_NAME,
    result._tag === "Success" ? result.value : null,
  );
  if (data === null || data.truncated) return null;
  return parseT3ProjectFile(data.contents);
}

/** Read `defaultThreadEnvMode` from the project's checked-in `t3.json`. */
export async function readT3ProjectFileDefaultThreadEnvMode(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<ThreadEnvMode | null> {
  return (await readT3ProjectFile(environmentId, workspaceRoot))?.defaultThreadEnvMode ?? null;
}

/**
 * Read `branchPrefix` from the project's checked-in `t3.json`.
 *
 * A null result means the project sets none, and the caller then uses T3
 * Code's default prefix.
 */
export async function readT3ProjectFileBranchPrefix(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<string | null> {
  return (await readT3ProjectFile(environmentId, workspaceRoot))?.branchPrefix ?? null;
}
