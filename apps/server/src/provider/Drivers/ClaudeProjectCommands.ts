/**
 * ClaudeProjectCommands - read the slash commands a repository carries.
 *
 * Claude Code reads a command from a Markdown file under `.claude/commands` or
 * `.agents/commands`. A file directly in the folder gives a flat name, and a
 * file one level down gives a namespaced one, `linear/scope.md` reading as
 * `linear:scope`.
 *
 * T3 Code learned its slash commands from a Claude subprocess, which reports
 * only what it sees from the directory it started in. Reading the files gives
 * the same answer for a repository without starting a process per thread.
 *
 * @module ClaudeProjectCommands
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { ServerProviderSlashCommand } from "@t3tools/contracts";

const COMMAND_FILE_SUFFIX = ".md";
const DESCRIPTION_PATTERN = /^description:\s*(.+)$/m;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Command roots, later winning a name collision, matching skill discovery. */
const COMMAND_ROOTS = [
  [".agents", "commands"],
  [".claude", "commands"],
] as const;

function readDescription(contents: string): string | undefined {
  const frontmatter = FRONTMATTER_PATTERN.exec(contents);
  if (frontmatter?.[1] === undefined) {
    return undefined;
  }
  const description = DESCRIPTION_PATTERN.exec(frontmatter[1])?.[1]?.trim();
  return description && description.length > 0 ? description : undefined;
}

function commandNameFor(entry: string, namespace: string | undefined): string | undefined {
  if (!entry.endsWith(COMMAND_FILE_SUFFIX)) {
    return undefined;
  }
  const base = entry.slice(0, -COMMAND_FILE_SUFFIX.length).trim();
  if (base.length === 0) {
    return undefined;
  }
  return namespace === undefined ? base : `${namespace}:${base}`;
}

/**
 * Read every slash command a repository carries.
 *
 * Never fails. A root that is absent or unreadable contributes nothing, which
 * is the common case for a repository that defines no commands.
 */
export const discoverClaudeProjectCommands = Effect.fn("discoverClaudeProjectCommands")(function* (
  cwd: string,
): Effect.fn.Return<
  ReadonlyArray<ServerProviderSlashCommand>,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const readEntries = (directory: string) =>
    fileSystem.readDirectory(directory).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

  // `stat` follows a symbolic link, so a linked file and a linked directory
  // both read as what they point at. George's command folders are entirely
  // links, and reading them as links would report nothing.
  const isDirectory = (target: string) =>
    fileSystem.stat(target).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

  const commandsByName = new Map<string, ServerProviderSlashCommand>();

  const addCommand = Effect.fn(function* (filePath: string, name: string) {
    const contents = yield* fileSystem
      .readFileString(filePath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (contents === undefined) {
      return;
    }
    const description = readDescription(contents);
    commandsByName.set(name, {
      name,
      ...(description ? { description } : {}),
    });
  });

  for (const segments of COMMAND_ROOTS) {
    const root = path.join(cwd, ...segments);

    for (const entry of [...(yield* readEntries(root))].sort()) {
      const entryPath = path.join(root, entry);

      const flatName = commandNameFor(entry, undefined);
      if (flatName !== undefined) {
        yield* addCommand(entryPath, flatName);
        continue;
      }

      if (!(yield* isDirectory(entryPath))) {
        continue;
      }
      for (const nested of [...(yield* readEntries(entryPath))].sort()) {
        const namespacedName = commandNameFor(nested, entry.trim());
        if (namespacedName !== undefined) {
          yield* addCommand(path.join(entryPath, nested), namespacedName);
        }
      }
    }
  }

  return [...commandsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
});
