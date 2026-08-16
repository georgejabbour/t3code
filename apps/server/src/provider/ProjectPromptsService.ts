/**
 * ProjectPromptsService - the skills and slash commands a repository carries.
 *
 * The provider reports one list of skills and one list of slash commands for
 * the whole server, built from the directory the server process started in.
 * That directory is the user's home folder, so a repository's own skills and
 * commands never reach the `/` menu or the `$` picker.
 *
 * This service answers the same question per directory instead. A thread asks
 * about its own working directory, and the composer adds the answer to the
 * provider's list.
 *
 * Both scans read the file system and start no process, so asking once per
 * open thread costs a directory listing rather than a Claude subprocess.
 *
 * This fork keeps its additions in new files, so an upstream change rarely
 * conflicts with them.
 *
 * @module ProjectPromptsService
 */
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import type { ProjectPrompts } from "@t3tools/contracts";

import { discoverClaudeProjectCommands } from "./Drivers/ClaudeProjectCommands.ts";
import { discoverClaudeSkills } from "./Drivers/ClaudeSkills.ts";

/**
 * How long one directory's answer is reused.
 *
 * Short, because a person who writes a skill expects the menu to show it
 * without restarting anything. Two directory listings are cheap enough to
 * repeat at this rate.
 */
export const PROJECT_PROMPTS_CACHE_TTL = Duration.seconds(15);

const PROJECT_PROMPTS_CACHE_CAPACITY = 64;

export class ProjectPromptsService extends Context.Service<
  ProjectPromptsService,
  {
    /**
     * Skills and slash commands the repository at `cwd` carries. Never fails:
     * a directory that holds none, or cannot be read, answers with empty
     * lists.
     */
    readonly getProjectPrompts: (cwd: string) => Effect.Effect<ProjectPrompts>;
  }
>()("t3/provider/ProjectPromptsService") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const discover = Effect.fn("ProjectPromptsService.discover")(function* (cwd: string) {
    // Only project scope is wanted here. The provider already reports user
    // scope, and repeating it would show every skill twice.
    const skills = yield* discoverClaudeSkills({ homePath: "" }, cwd).pipe(
      Effect.map((all) => all.filter((skill) => skill.scope === "project")),
      Effect.orElseSucceed(() => []),
    );
    const slashCommands = yield* discoverClaudeProjectCommands(cwd).pipe(
      Effect.orElseSucceed(() => []),
    );
    return { skills, slashCommands } satisfies ProjectPrompts;
  });

  const cache = yield* Cache.make<string, ProjectPrompts>({
    capacity: PROJECT_PROMPTS_CACHE_CAPACITY,
    timeToLive: PROJECT_PROMPTS_CACHE_TTL,
    lookup: (cwd: string) =>
      discover(cwd).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      ),
  });

  const getProjectPrompts: ProjectPromptsService["Service"]["getProjectPrompts"] = (cwd) => {
    const trimmed = cwd.trim();
    if (trimmed.length === 0) {
      return Effect.succeed({ skills: [], slashCommands: [] });
    }
    return Cache.get(cache, trimmed).pipe(
      Effect.orElseSucceed(() => ({ skills: [], slashCommands: [] })),
    );
  };

  return ProjectPromptsService.of({ getProjectPrompts });
});

export const layer = Layer.effect(ProjectPromptsService, make);
