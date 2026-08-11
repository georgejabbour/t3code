import type { ProjectEntry } from "@t3tools/contracts";

export interface FileTreeExpansionModel {
  getItem(path: string): unknown;
}

type DirectoryHandle = {
  isDirectory(): boolean;
  isExpanded(): boolean;
  expand(): void;
  collapse(): void;
};

function asDirectoryHandle(item: unknown): DirectoryHandle | null {
  if (
    typeof item !== "object" ||
    item === null ||
    !("isDirectory" in item) ||
    typeof item.isDirectory !== "function" ||
    !item.isDirectory() ||
    !("isExpanded" in item) ||
    typeof item.isExpanded !== "function" ||
    !("expand" in item) ||
    typeof item.expand !== "function" ||
    !("collapse" in item) ||
    typeof item.collapse !== "function"
  ) {
    return null;
  }
  return item as DirectoryHandle;
}

export function areAllDirectoriesExpanded(
  model: FileTreeExpansionModel,
  directoryPaths: readonly string[],
): boolean {
  return (
    directoryPaths.length > 0 &&
    directoryPaths.every((path) => {
      const item = asDirectoryHandle(model.getItem(path));
      return item !== null && item.isExpanded();
    })
  );
}

export function setAllDirectoriesExpanded(
  model: FileTreeExpansionModel,
  directoryPaths: readonly string[],
  expanded: boolean,
): void {
  for (const path of directoryPaths) {
    const item = asDirectoryHandle(model.getItem(path));
    if (item === null || item.isExpanded() === expanded) continue;
    if (expanded) item.expand();
    else item.collapse();
  }
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
 * reader's own choices, including a whole tree the reader opened with the
 * expand-all control.
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
