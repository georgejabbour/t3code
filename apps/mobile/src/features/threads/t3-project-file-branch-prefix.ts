import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { T3_PROJECT_FILE_NAME, type EnvironmentId } from "@t3tools/contracts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";

import { appAtomRegistry } from "../../state/atom-registry";
import { projectEnvironment } from "../../state/projects";

/**
 * Read `branchPrefix` from the project's checked-in `t3.json`.
 *
 * The thread-start path needs the prefix at call time rather than render time,
 * so this reads the file query directly. A missing, truncated, or invalid file
 * resolves to null, and the caller then uses T3 Code's default prefix.
 */
export async function readT3ProjectFileBranchPrefix(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<string | null> {
  if (workspaceRoot === "") {
    return null;
  }

  const result = await executeAtomQuery(
    appAtomRegistry,
    projectEnvironment.readFile({
      environmentId,
      input: { cwd: workspaceRoot, relativePath: T3_PROJECT_FILE_NAME },
    }),
    { label: "t3.json branch prefix", reportDefect: false, reportFailure: false },
  );
  if (result._tag !== "Success" || result.value.truncated) {
    return null;
  }
  return parseT3ProjectFile(result.value.contents)?.branchPrefix ?? null;
}
