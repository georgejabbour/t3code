/**
 * useProjectPrompts - the skills and slash commands the open repository holds.
 *
 * A provider reports one list of skills and one of slash commands for the
 * whole server, discovered from the directory the server started in. That
 * directory is the user's home folder, so a repository's own skills and
 * commands never appear. This asks the server about the thread's own
 * directory and merges the answer into those lists.
 *
 * This fork keeps its additions in new files, so an upstream change rarely
 * conflicts with them.
 */
import {
  EnvironmentId,
  type ProjectPrompts,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { useMemo } from "react";

import { serverEnvironment } from "~/state/server";

const EMPTY_PROMPTS: ProjectPrompts = { skills: [], slashCommands: [] };

// React runs every hook on every render, so a thread with no directory still
// calls the query hook. The request is never sent, so this only has to be a
// name no real environment takes.
const NO_ENVIRONMENT_ID = EnvironmentId.make("t3code:no-environment");

/**
 * Merge two lists that key on `name`, letting the repository win.
 *
 * A repository that defines a skill or command under a name the user also
 * defines means the more specific one, so the repository's entry replaces the
 * user's rather than appearing beside it under the same name.
 */
export function mergePromptsByName<T extends { readonly name: string }>(
  fromUser: ReadonlyArray<T>,
  fromProject: ReadonlyArray<T>,
): ReadonlyArray<T> {
  if (fromProject.length === 0) {
    return fromUser;
  }
  const byName = new Map(fromUser.map((entry) => [entry.name, entry]));
  for (const entry of fromProject) {
    byName.set(entry.name, entry);
  }
  return [...byName.values()];
}

/** Skills and slash commands for the repository open in this thread. */
export function useProjectPrompts(
  environmentId: EnvironmentId | null,
  cwd: string | null,
): ProjectPrompts {
  const enabled = environmentId !== null && cwd !== null && cwd.trim().length > 0;
  const result = useAtomValue(
    serverEnvironment.projectPrompts({
      environmentId: enabled ? environmentId : NO_ENVIRONMENT_ID,
      input: { cwd: enabled ? cwd : "" },
    }),
  );

  const value = Option.getOrNull(AsyncResult.value(result)) as ProjectPrompts | null;
  return value ?? EMPTY_PROMPTS;
}

/** Provider skills with the repository's own skills merged in. */
export function useSkillsWithProject(
  providerSkills: ReadonlyArray<ServerProviderSkill>,
  projectSkills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<ServerProviderSkill> {
  return useMemo(
    () => mergePromptsByName(providerSkills, projectSkills),
    [providerSkills, projectSkills],
  );
}

/** Provider slash commands with the repository's own commands merged in. */
export function useSlashCommandsWithProject(
  providerCommands: ReadonlyArray<ServerProviderSlashCommand>,
  projectCommands: ReadonlyArray<ServerProviderSlashCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  return useMemo(
    () => mergePromptsByName(providerCommands, projectCommands),
    [providerCommands, projectCommands],
  );
}
