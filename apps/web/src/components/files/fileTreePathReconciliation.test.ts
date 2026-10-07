import { FileTree } from "@pierre/trees";
import { describe, expect, it } from "vite-plus/test";

import { buildFileTreePathUpdates } from "./fileTreePathReconciliation";

describe("buildFileTreePathUpdates", () => {
  it("keeps initial folders closed and preserves expansion through incremental refreshes", () => {
    const model = new FileTree({ paths: [], initialExpansion: "closed" });
    try {
      const previous = ["src/", "src/kept.ts", "src/removed.ts"];
      model.resetPaths(previous);
      const directory = model.getItem("src/");
      if (directory === null || !("expand" in directory)) throw new Error("Missing directory");
      expect(directory.isExpanded()).toBe(false);
      directory.expand();
      model.batch(
        buildFileTreePathUpdates(previous, [
          "src/",
          "src/kept.ts",
          "src/added.ts",
          "docs/",
          "docs/index.md",
        ]),
      );
      expect(directory.isExpanded()).toBe(true);
      const added = model.getItem("docs/");
      if (added === null || !("isExpanded" in added)) throw new Error("Missing added directory");
      expect(added.isExpanded()).toBe(false);
      directory.collapse();
      expect(directory.isExpanded()).toBe(false);
    } finally {
      model.cleanUp();
    }
  });
  it("updates only paths that changed", () => {
    expect(
      buildFileTreePathUpdates(
        ["src/", "src/kept.ts", "src/removed.ts"],
        ["src/", "src/kept.ts", "src/added.ts"],
      ),
    ).toEqual([
      { type: "remove", path: "src/removed.ts" },
      { type: "add", path: "src/added.ts" },
    ]);
  });

  it("removes a missing subtree with one recursive update", () => {
    expect(
      buildFileTreePathUpdates(
        ["src/", "src/feature/", "src/feature/index.ts", "src/kept.ts"],
        ["src/", "src/kept.ts"],
      ),
    ).toEqual([{ type: "remove", path: "src/feature/", recursive: true }]);
  });

  it("does nothing when a refresh returns the same tree", () => {
    const paths = ["src/", "src/index.ts"];
    expect(buildFileTreePathUpdates(paths, [...paths])).toEqual([]);
  });
});
