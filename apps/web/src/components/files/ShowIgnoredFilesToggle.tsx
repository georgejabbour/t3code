import { Eye, EyeOff } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useShowIgnoredFiles } from "~/showIgnoredFilesPreference";

/**
 * The control that shows or hides the files Git ignores.
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
