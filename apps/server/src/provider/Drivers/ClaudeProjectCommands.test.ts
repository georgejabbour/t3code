import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { discoverClaudeProjectCommands } from "./ClaudeProjectCommands.ts";

const writeCommand = Effect.fn(function* (directory: string, fileName: string, contents: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(directory, { recursive: true });
  yield* fs.writeFileString(path.join(directory, fileName), contents);
});

it.layer(NodeServices.layer)("discoverClaudeProjectCommands", (it) => {
  it.effect("reads a command from the repository, not the server's directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-commands-" });
      const workspace = path.join(tempDir, "workspace");

      yield* writeCommand(
        path.join(workspace, ".claude", "commands"),
        "weekly-update.md",
        ["---", "description: Write the weekly update.", "---", "", "Body"].join("\n"),
      );

      const commands = yield* discoverClaudeProjectCommands(workspace);

      assert.deepStrictEqual(
        commands.map((command) => command.name),
        ["weekly-update"],
      );
      assert.strictEqual(commands[0]?.description, "Write the weekly update.");
    }),
  );

  it.effect("reads both command roots, with .claude winning a name collision", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-commands-" });
      const workspace = path.join(tempDir, "workspace");

      yield* writeCommand(
        path.join(workspace, ".agents", "commands"),
        "shared.md",
        ["---", "description: From agents.", "---"].join("\n"),
      );
      yield* writeCommand(
        path.join(workspace, ".claude", "commands"),
        "shared.md",
        ["---", "description: From claude.", "---"].join("\n"),
      );

      const commands = yield* discoverClaudeProjectCommands(workspace);

      assert.deepStrictEqual(
        commands.map((command) => command.name),
        ["shared"],
      );
      assert.strictEqual(commands[0]?.description, "From claude.");
    }),
  );

  it.effect("namespaces a command inside a directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-commands-" });
      const workspace = path.join(tempDir, "workspace");

      yield* writeCommand(
        path.join(workspace, ".claude", "commands", "linear"),
        "scope.md",
        ["---", "description: Scope a ticket.", "---"].join("\n"),
      );

      const commands = yield* discoverClaudeProjectCommands(workspace);

      assert.deepStrictEqual(
        commands.map((command) => command.name),
        ["linear:scope"],
      );
    }),
  );

  it.effect("follows a file link and a directory link", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-commands-" });
      const workspace = path.join(tempDir, "workspace");
      const source = path.join(workspace, "skills", "eve", "commands");

      yield* writeCommand(
        source,
        "eve-update.md",
        ["---", "description: Update.", "---"].join("\n"),
      );
      yield* writeCommand(
        path.join(workspace, "skills", "linear", "commands"),
        "scope.md",
        ["---", "description: Scope.", "---"].join("\n"),
      );

      const commandsDir = path.join(workspace, ".claude", "commands");
      yield* fs.makeDirectory(commandsDir, { recursive: true });
      yield* fs.symlink(
        path.join(source, "eve-update.md"),
        path.join(commandsDir, "eve-update.md"),
      );
      yield* fs.symlink(
        path.join(workspace, "skills", "linear", "commands"),
        path.join(commandsDir, "linear"),
      );

      const commands = yield* discoverClaudeProjectCommands(workspace);

      assert.deepStrictEqual(commands.map((command) => command.name).sort(), [
        "eve-update",
        "linear:scope",
      ]);
    }),
  );

  it.effect("returns nothing when the repository holds no commands", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-commands-" });

      const commands = yield* discoverClaudeProjectCommands(path.join(tempDir, "workspace"));

      assert.deepStrictEqual(commands, []);
    }),
  );
});
