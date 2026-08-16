/**
 * SubscriptionSidebarButton - the subscription selector in the sidebar footer.
 *
 * Self-contained on purpose. It resolves the environment, reads the chosen
 * subscription and writes the new one itself, so the sidebar only has to place
 * one component. That keeps this fork's edit to the sidebar a single line, and
 * a single line rarely conflicts with an upstream change.
 */
import type { ProviderInstanceId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { GaugeIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { SidebarMenuButton, SidebarMenuItem } from "~/components/ui/sidebar";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { primaryServerSettingsAtom, serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { SubscriptionSelectorPanel } from "./SubscriptionSelectorPanel";

export function SubscriptionSidebarButton() {
  const [isOpen, setIsOpen] = useState(false);
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const settings = useAtomValue(primaryServerSettingsAtom);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });

  const activeInstanceId =
    settings.activeSubscriptionInstanceId.trim().length > 0
      ? settings.activeSubscriptionInstanceId
      : null;

  const handleSelect = useCallback(
    (instanceId: ProviderInstanceId) => {
      setIsOpen(false);
      if (environmentId === null) {
        return;
      }
      void updateSettings({
        environmentId,
        input: { patch: { activeSubscriptionInstanceId: instanceId } },
      });
    },
    [environmentId, updateSettings],
  );

  const handleAfterAdd = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <SidebarMenuItem className="shrink-0">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <SidebarMenuButton
                    aria-label="Claude subscriptions"
                    data-testid="subscription-sidebar-button"
                    size="icon"
                  >
                    <GaugeIcon />
                  </SidebarMenuButton>
                }
              />
            }
          />
          <TooltipPopup side="top">Claude subscriptions</TooltipPopup>
        </Tooltip>
        <PopoverPopup align="start" side="top">
          <SubscriptionSelectorPanel
            environmentId={environmentId}
            activeInstanceId={activeInstanceId}
            onSelect={handleSelect}
            onAfterAddSubscription={handleAfterAdd}
          />
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}
