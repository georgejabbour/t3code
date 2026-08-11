import * as Schema from "effect/Schema";

import { useLocalStorage } from "./hooks/useLocalStorage";

/**
 * This key is the fork's build marker for the "show ignored files" patch. It
 * reaches the browser storage interface as a literal, so a bundler cannot
 * rename it. A build that lost the patch loses the marker too.
 */
const SHOW_IGNORED_FILES_KEY = "t3code:file-explorer-show-ignored";

/**
 * Whether the file lists hold the files that Git ignores.
 *
 * One preference serves three lists: the file explorer tree, the `@` mention
 * menu in the composer, and the file picker. `useLocalStorage` tells every
 * component in the tab about a change, so all three lists update together.
 *
 * This module holds no user interface, because the query hooks in
 * `state/queries.ts` read it. A state module must not pull button and tooltip
 * components into its own module graph.
 */
export function useShowIgnoredFiles() {
  return useLocalStorage(SHOW_IGNORED_FILES_KEY, false, Schema.Boolean);
}
