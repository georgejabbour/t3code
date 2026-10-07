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
});
