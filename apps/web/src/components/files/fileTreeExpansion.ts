import type { ProjectEntry } from "@t3tools/contracts";

/** The part of the tree model this helper needs. */
interface FileTreeExpansionModel {
  getItem: (path: string) => unknown;
}

/**
 * Directory rows carry a trailing separator in the tree, and file rows do not.
 * This matches `treePath` in FileBrowserPanel.
 */
function directoryId(path: string): string {
  return `${path}/`;
}

function isExpandedHandle(item: unknown): boolean {
  return (
    typeof item === "object" &&
    item !== null &&
    "isExpanded" in item &&
    typeof (item as { isExpanded: unknown }).isExpanded === "function" &&
    (item as { isExpanded: () => boolean }).isExpanded()
  );
}

/**
 * Lists the folders the reader has open right now.
 *
 * `resetPaths` builds a new store and forgets which folders were open. The
 * panel calls it on every entry refresh, which happens about twice a minute.
 * Before this mattered, the tree reopened the top level each time and hid the
 * loss. With folders shut by default, an open folder would shut again on its
 * own within a minute. Passing this list back into `resetPaths` keeps the
 * reader's own choices.
 *
 * @param entryKinds the kinds for the paths the tree holds NOW, not the paths
 *   that are about to replace them.
 */
export function readExpandedDirectoryPaths(
  model: FileTreeExpansionModel,
  entryKinds: ReadonlyMap<string, ProjectEntry["kind"]>,
): string[] {
  const expanded: string[] = [];
  for (const [path, kind] of entryKinds) {
    if (kind !== "directory") continue;
    const item = model.getItem(directoryId(path)) ?? model.getItem(path);
    if (isExpandedHandle(item)) {
      expanded.push(directoryId(path));
    }
  }
  return expanded;
}
