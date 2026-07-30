import type { ProjectScript, T3ProjectFileScript } from "@t3tools/contracts";

interface ProjectScriptRuntimeEnvInput {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
  extraEnv?: Record<string, string>;
}

export function projectScriptCwd(input: {
  project: {
    cwd: string;
  };
  worktreePath?: string | null;
}): string {
  return input.worktreePath ?? input.project.cwd;
}

export function projectScriptRuntimeEnv(
  input: ProjectScriptRuntimeEnvInput,
): Record<string, string> {
  const env: Record<string, string> = {
    T3CODE_PROJECT_ROOT: input.project.cwd,
  };
  if (input.worktreePath) {
    env.T3CODE_WORKTREE_PATH = input.worktreePath;
  }
  if (input.extraEnv) {
    return { ...env, ...input.extraEnv };
  }
  return env;
}

export function setupProjectScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeCreate) ?? null;
}

/**
 * The flagged script from a checked-in `t3.json`, so a repository that edits
 * that file takes effect without re-importing.
 */
export function worktreeRemoveProjectScript(
  scripts: readonly T3ProjectFileScript[],
): T3ProjectFileScript | null {
  return scripts.find((script) => script.runOnWorktreeRemove === true) ?? null;
}

/**
 * The same flag on the project's IMPORTED scripts — what the scripts dialog's
 * toggle writes. Checked only after `t3.json`, so a repository that ships the
 * flag keeps deciding for every clone while the toggle covers projects that
 * check in nothing.
 */
export function worktreeRemoveScript(scripts: readonly ProjectScript[]): ProjectScript | null {
  return scripts.find((script) => script.runOnWorktreeRemove === true) ?? null;
}
