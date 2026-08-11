import { describe, expect, it, vi } from "@effect/vitest";

import type { ProjectEntry } from "@t3tools/contracts";

import {
  areAllDirectoriesExpanded,
  readExpandedDirectoryPaths,
  setAllDirectoriesExpanded,
} from "./fileTreeExpansion";

type FakeDirectoryItem = {
  isDirectory: () => true;
  isExpanded: () => boolean;
  expand: () => void;
  collapse: () => void;
};

function makeModel(expanded: Record<string, boolean>) {
  const items = new Map<string, FakeDirectoryItem>();
  return {
    getItem: (path: string) => {
      const existing = items.get(path);
      if (existing !== undefined) return existing;
      const item: FakeDirectoryItem = {
        isDirectory: () => true,
        isExpanded: () => expanded[path] ?? false,
        expand: () => {
          expanded[path] = true;
        },
        collapse: () => {
          expanded[path] = false;
        },
      };
      items.set(path, item);
      return item;
    },
  };
}

describe("file tree expansion", () => {
  it("requires at least one directory and detects whether all are expanded", () => {
    const model = makeModel({ "src/": true, "test/": true });
    expect(areAllDirectoriesExpanded(model, [])).toBe(false);
    expect(areAllDirectoriesExpanded(model, ["src/", "test/"])).toBe(true);
    expect(
      areAllDirectoriesExpanded(makeModel({ "src/": true, "test/": false }), ["src/", "test/"]),
    ).toBe(false);
  });

  it("expands and collapses every directory", () => {
    const expanded = { "src/": true, "test/": false };
    const model = makeModel(expanded);
    setAllDirectoriesExpanded(model, ["src/", "test/"], true);
    expect(expanded).toEqual({ "src/": true, "test/": true });
    setAllDirectoriesExpanded(model, ["src/", "test/"], false);
    expect(expanded).toEqual({ "src/": false, "test/": false });
  });

  it("skips directories already at the requested state", () => {
    const model = makeModel({ "src/": true });
    const item = model.getItem("src/");
    const collapse = vi.spyOn(item, "collapse");
    setAllDirectoriesExpanded(model, ["src/"], true);
    expect(collapse).not.toHaveBeenCalled();
  });
});

/**
 * A tree that holds only the identifiers it was given. `getItem` answers
 * `undefined` for anything else, the way the real tree answers for a row it no
 * longer holds.
 */
function makeOpenFolderModel(expandedIds: ReadonlyArray<string>, knownIds?: ReadonlyArray<string>) {
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
    const model = makeOpenFolderModel(["src/"]);

    expect(readExpandedDirectoryPaths(model, kinds({ src: "directory" }))).toEqual(["src/"]);
  });

  it("leaves out a folder the reader has shut", () => {
    const model = makeOpenFolderModel([], ["src/"]);

    expect(readExpandedDirectoryPaths(model, kinds({ src: "directory" }))).toEqual([]);
  });

  it("ignores files", () => {
    const model = makeOpenFolderModel(["README.md"]);

    expect(readExpandedDirectoryPaths(model, kinds({ "README.md": "file" }))).toEqual([]);
  });

  it("ignores a folder the tree no longer holds", () => {
    const model = makeOpenFolderModel([]);

    expect(readExpandedDirectoryPaths(model, kinds({ removed: "directory" }))).toEqual([]);
  });

  it("falls back to the identifier without a separator", () => {
    const model = makeOpenFolderModel(["src"], ["src"]);

    expect(readExpandedDirectoryPaths(model, kinds({ src: "directory" }))).toEqual(["src/"]);
  });

  it("reports every open folder and keeps the shut ones out", () => {
    const model = makeOpenFolderModel(
      ["src/", "src/components/"],
      ["src/", "src/components/", "docs/"],
    );

    expect(
      readExpandedDirectoryPaths(
        model,
        kinds({ src: "directory", "src/components": "directory", docs: "directory" }),
      ),
    ).toEqual(["src/", "src/components/"]);
  });

  it("keeps a whole tree the reader opened with the expand-all control", () => {
    const expanded = { "src/": false, "docs/": false };
    const model = makeModel(expanded);
    setAllDirectoriesExpanded(model, ["src/", "docs/"], true);

    expect(
      readExpandedDirectoryPaths(model, kinds({ src: "directory", docs: "directory" })),
    ).toEqual(["src/", "docs/"]);
  });
});
