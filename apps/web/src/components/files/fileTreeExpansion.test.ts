import { describe, expect, it } from "vite-plus/test";

import type { ProjectEntry } from "@t3tools/contracts";

import { readExpandedDirectoryPaths } from "./fileTreeExpansion";

function makeModel(expandedIds: ReadonlyArray<string>, knownIds?: ReadonlyArray<string>) {
  const known = new Set(knownIds ?? expandedIds);
  return {
    getItem: (path: string) =>
      known.has(path) ? { isExpanded: () => expandedIds.includes(path) } : undefined,
  };
}

const kinds = (entries: Record<string, ProjectEntry["kind"]>) =>
  new Map(Object.entries(entries)) as ReadonlyMap<string, ProjectEntry["kind"]>;

describe("readExpandedDirectoryPaths", () => {
  it("reports an open folder with the trailing separator the tree uses", () => {
    const model = makeModel(["src/"]);

    expect(readExpandedDirectoryPaths(model, kinds({ src: "directory" }))).toEqual(["src/"]);
  });

  it("leaves out a folder the reader has shut", () => {
    const model = makeModel([], ["src/"]);

    expect(readExpandedDirectoryPaths(model, kinds({ src: "directory" }))).toEqual([]);
  });

  it("ignores files", () => {
    const model = makeModel(["README.md"]);

    expect(readExpandedDirectoryPaths(model, kinds({ "README.md": "file" }))).toEqual([]);
  });

  it("ignores a folder the tree no longer holds", () => {
    const model = makeModel([]);

    expect(readExpandedDirectoryPaths(model, kinds({ removed: "directory" }))).toEqual([]);
  });

  it("falls back to the identifier without a separator", () => {
    const model = makeModel(["src"], ["src"]);

    expect(readExpandedDirectoryPaths(model, kinds({ src: "directory" }))).toEqual(["src/"]);
  });

  it("reports every open folder and keeps the shut ones out", () => {
    const model = makeModel(["src/", "src/components/"], ["src/", "src/components/", "docs/"]);

    expect(
      readExpandedDirectoryPaths(
        model,
        kinds({ src: "directory", "src/components": "directory", docs: "directory" }),
      ),
    ).toEqual(["src/", "src/components/"]);
  });
});
