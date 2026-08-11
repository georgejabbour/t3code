import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as IgnoredWorkspaceEntries from "./IgnoredWorkspaceEntries.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provide(
    ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-ignored-workspace-entries-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    const result = yield* process.run({
      operation: "IgnoredWorkspaceEntries.test.git",
      command: "git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });

const makeTempDir = Effect.fn(function* (opts?: { prefix?: string; git?: boolean }) {
  const fileSystem = yield* FileSystem.FileSystem;
  const dir = yield* fileSystem.makeTempDirectoryScoped({
    prefix: opts?.prefix ?? "t3code-ignored-entries-",
  });
  if (opts?.git) {
    yield* git(dir, ["init"]);
  }
  return dir;
});

function writeTextFile(
  cwd: string,
  relativePath: string,
  contents = "",
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolutePath = path.join(cwd, relativePath);
    yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
    yield* fileSystem.writeFileString(absolutePath, contents);
  });
}

const entry = (path: string, kind: "file" | "directory") => ({ path, kind }) as const;

describe("toIgnoredEntries", () => {
  it("adds a row for every parent folder git does not report", () => {
    const result = IgnoredWorkspaceEntries.toIgnoredEntries(["build/out/app.js"], false, 100);

    expect(result.entries).toEqual([
      entry("build", "directory"),
      entry("build/out", "directory"),
      entry("build/out/app.js", "file"),
    ]);
    expect(result.truncated).toBe(false);
  });

  it("drops a path that holds an always-hidden folder name", () => {
    const result = IgnoredWorkspaceEntries.toIgnoredEntries(
      ["node_modules/pkg/index.js", "apps/web/node_modules/pkg/index.js", ".git/config", ".env"],
      false,
      100,
    );

    expect(result.entries).toEqual([entry(".env", "file")]);
  });

  it("refuses an absolute path and a path that climbs out of the workspace", () => {
    const result = IgnoredWorkspaceEntries.toIgnoredEntries(
      ["/etc/passwd", "../outside.txt", "keep.env"],
      false,
      100,
    );

    expect(result.entries).toEqual([entry("keep.env", "file")]);
  });

  it("reports truncated when the cap removes entries", () => {
    const result = IgnoredWorkspaceEntries.toIgnoredEntries(["a.txt", "b.txt", "c.txt"], false, 2);

    expect(result.entries).toEqual([entry("a.txt", "file"), entry("b.txt", "file")]);
    expect(result.truncated).toBe(true);
  });

  it("keeps git's own truncation flag", () => {
    const result = IgnoredWorkspaceEntries.toIgnoredEntries(["a.txt"], true, 100);

    expect(result.truncated).toBe(true);
  });
});

describe("mergeIgnoredEntries", () => {
  const base = {
    entries: [entry("src", "directory"), entry("src/app.ts", "file")],
    truncated: false,
  };

  it("returns the index result untouched when nothing is ignored", () => {
    expect(
      IgnoredWorkspaceEntries.mergeIgnoredEntries(base, { entries: [], truncated: false }, 100),
    ).toBe(base);
  });

  it("joins both lists and sorts them by path", () => {
    const result = IgnoredWorkspaceEntries.mergeIgnoredEntries(
      base,
      { entries: [entry(".env", "file")], truncated: false },
      100,
    );

    expect(result.entries).toEqual([
      entry(".env", "file"),
      entry("src", "directory"),
      entry("src/app.ts", "file"),
    ]);
  });

  it("lets the index decide the kind of a path both lists hold", () => {
    const result = IgnoredWorkspaceEntries.mergeIgnoredEntries(
      { entries: [entry("dist", "directory")], truncated: false },
      { entries: [entry("dist", "file")], truncated: false },
      100,
    );

    expect(result.entries).toEqual([entry("dist", "directory")]);
  });

  it("reports truncated when the cap removes entries", () => {
    const result = IgnoredWorkspaceEntries.mergeIgnoredEntries(
      base,
      { entries: [entry(".env", "file")], truncated: false },
      2,
    );

    expect(result.entries).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});

describe("rankIgnoredEntries", () => {
  const ignored = [
    entry("config", "directory"),
    entry("config/.env", "file"),
    entry(".env", "file"),
    entry("logo.png", "file"),
  ];

  it("ranks a file whose name matches the query above a deeper path", () => {
    const result = IgnoredWorkspaceEntries.rankIgnoredEntries(ignored, "env", 10);

    expect(result[0]).toEqual(entry(".env", "file"));
    expect(result.map((item) => item.path)).toContain("config/.env");
  });

  it("honors the kind filter", () => {
    const result = IgnoredWorkspaceEntries.rankIgnoredEntries(ignored, "config", 10, {
      kind: "directory",
    });

    expect(result).toEqual([entry("config", "directory")]);
  });

  it("honors the image-only filter", () => {
    const result = IgnoredWorkspaceEntries.rankIgnoredEntries(ignored, "logo", 10, {
      imageOnly: true,
    });

    expect(result).toEqual([entry("logo.png", "file")]);
  });

  it("skips a path the index already returned", () => {
    const result = IgnoredWorkspaceEntries.rankIgnoredEntries(ignored, "env", 10, {
      excludePaths: new Set([".env"]),
    });

    expect(result.map((item) => item.path)).not.toContain(".env");
  });

  it("returns entries in path order for an empty query", () => {
    const result = IgnoredWorkspaceEntries.rankIgnoredEntries(ignored, "", 2);

    expect(result).toEqual([entry("config", "directory"), entry("config/.env", "file")]);
  });

  it("returns nothing when the limit leaves no room", () => {
    expect(IgnoredWorkspaceEntries.rankIgnoredEntries(ignored, "env", 0)).toEqual([]);
  });
});

it.layer(TestLayer, { excludeTestServices: true })("IgnoredWorkspaceEntries", (it) => {
  it.effect("shows an ignored file only when the caller asks for it", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTempDir({ prefix: "t3code-ignored-visible-", git: true });
      yield* writeTextFile(cwd, ".gitignore", ".env\ndist/\n");
      yield* writeTextFile(cwd, ".env", "SECRET=1");
      yield* writeTextFile(cwd, "dist/app.js", "// built");
      yield* writeTextFile(cwd, "src/keep.ts", "export {};");

      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

      const hidden = yield* workspaceEntries.list({ cwd });
      expect(hidden.entries.map((item) => item.path)).not.toContain(".env");

      const shown = yield* workspaceEntries.list({ cwd, includeIgnored: true });
      const paths = shown.entries.map((item) => item.path);
      expect(paths).toContain(".env");
      expect(paths).toContain("dist");
      expect(paths).toContain("dist/app.js");
      expect(paths).toContain("src/keep.ts");
    }),
  );

  it.effect("keeps node_modules hidden even when the caller asks for ignored files", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTempDir({ prefix: "t3code-ignored-node-modules-", git: true });
      yield* writeTextFile(cwd, ".gitignore", "node_modules/\n.env\n");
      yield* writeTextFile(cwd, "node_modules/pkg/index.js", "module.exports = {};");
      yield* writeTextFile(cwd, ".env", "SECRET=1");

      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
      const result = yield* workspaceEntries.list({ cwd, includeIgnored: true });
      const paths = result.entries.map((item) => item.path);

      expect(paths).toContain(".env");
      expect(paths.some((path) => path.startsWith("node_modules"))).toBe(false);
    }),
  );

  it.effect("shows a tracked file that a later ignore rule also matches", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTempDir({ prefix: "t3code-ignored-tracked-", git: true });
      yield* writeTextFile(cwd, "secrets/keys.json", "{}");
      yield* git(cwd, ["add", "secrets/keys.json"]);
      yield* writeTextFile(cwd, ".gitignore", "secrets/\n");

      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
      const result = yield* workspaceEntries.list({ cwd, includeIgnored: true });

      expect(result.entries.map((item) => item.path)).toContain("secrets/keys.json");
    }),
  );

  it.effect("changes nothing in a folder that is not a git repository", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTempDir({ prefix: "t3code-ignored-non-git-" });
      yield* writeTextFile(cwd, "src/keep.ts", "export {};");
      yield* writeTextFile(cwd, ".env", "SECRET=1");

      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
      const hidden = yield* workspaceEntries.list({ cwd });
      const shown = yield* workspaceEntries.list({ cwd, includeIgnored: true });

      expect(shown.entries).toEqual(hidden.entries);
    }),
  );

  it.effect("offers an ignored file to search once the caller asks for it", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTempDir({ prefix: "t3code-ignored-search-", git: true });
      yield* writeTextFile(cwd, ".gitignore", ".env.local\n");
      yield* writeTextFile(cwd, ".env.local", "SECRET=1");
      yield* writeTextFile(cwd, "src/keep.ts", "export {};");

      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

      const hidden = yield* workspaceEntries.search({ cwd, query: "env", limit: 20 });
      expect(hidden.entries.map((item) => item.path)).not.toContain(".env.local");

      const shown = yield* workspaceEntries.search({
        cwd,
        query: "env",
        limit: 20,
        includeIgnored: true,
      });
      expect(shown.entries.map((item) => item.path)).toContain(".env.local");
    }),
  );

  it.effect("never lists the same path twice in a search result", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTempDir({ prefix: "t3code-ignored-search-dedupe-", git: true });
      yield* writeTextFile(cwd, ".gitignore", "notes.txt\n");
      yield* writeTextFile(cwd, "notes.txt", "hello");
      yield* writeTextFile(cwd, "notes-kept.txt", "hello");

      const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
      const result = yield* workspaceEntries.search({
        cwd,
        query: "notes",
        limit: 20,
        includeIgnored: true,
      });
      const paths = result.entries.map((item) => item.path);

      expect(new Set(paths).size).toBe(paths.length);
      expect(paths).toContain("notes.txt");
      expect(paths).toContain("notes-kept.txt");
    }),
  );
});
