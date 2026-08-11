import { Eye, EyeOff } from "lucide-react";
import * as Schema from "effect/Schema";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useLocalStorage } from "~/hooks/useLocalStorage";

/**
 * This key is the fork's build marker for the "show ignored files" patch. It
 * reaches the browser storage interface as a literal, so a bundler cannot
 * rename it. A build that lost the patch loses the marker too.
 */
const SHOW_IGNORED_FILES_KEY = "t3code:file-explorer-show-ignored";

/**
 * Whether the file lists hold the files that git ignores.
 *
 * One preference serves three lists: the file explorer tree, the `@` mention
 * menu in the composer, and the file picker. `useLocalStorage` tells every
 * component in the tab about a change, so all three lists update together.
 */
export function useShowIgnoredFiles() {
  return useLocalStorage(SHOW_IGNORED_FILES_KEY, false, Schema.Boolean);
}

/**
 * The control that flips the preference.
 *
 * The label names what a tap does next, not the state the tree is in now.
 */
export function ShowIgnoredFilesToggle() {
  const [showIgnored, setShowIgnored] = useShowIgnoredFiles();
  const label = showIgnored ? "Hide files Git ignores" : "Show files Git ignores";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-pressed={showIgnored}
            data-file-explorer-show-ignored={showIgnored ? "true" : "false"}
            onClick={() => setShowIgnored(!showIgnored)}
          />
        }
      >
        {showIgnored ? <Eye /> : <EyeOff />}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
