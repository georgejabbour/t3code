import { useParams } from "@tanstack/react-router";
import { MemoryStickIcon } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { SidebarMenuButton, SidebarMenuItem, useSidebarVisibility } from "~/components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { formatMemoryBytes, useHostResources } from "~/hooks/useHostResources";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useActiveEnvironmentId } from "~/state/entities";
import { useEnvironment } from "~/state/environments";
import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "~/threadRoutes";

const statusColor = {
  Normal: "text-success-foreground",
  Warning: "text-warning-foreground",
  Critical: "text-destructive",
  Unavailable: "text-muted-foreground",
  Stale: "text-muted-foreground",
};

export function MemorySidebarButton() {
  const target = useParams({ strict: false, select: resolveThreadRouteTarget });
  const draft = useComposerDraftStore((store) =>
    target?.kind === "draft" ? store.getDraftSession(target.draftId) : null,
  );
  const route = resolveActiveThreadRouteRef(target, draft);
  const activeEnvironmentId = useActiveEnvironmentId();
  const environment = useEnvironment(
    route?.environmentId ?? draft?.environmentId ?? activeEnvironmentId,
  );
  const visible = useSidebarVisibility();
  return (
    <MemorySidebarIndicator
      key={environment?.environmentId ?? "none"}
      environment={environment}
      visible={visible}
    />
  );
}

function MemorySidebarIndicator({
  environment,
  visible,
}: {
  environment: ReturnType<typeof useEnvironment>;
  visible: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const query = useHostResources(environment?.environmentId ?? null, {
    connected: environment?.connection.phase === "connected",
    visible,
    open: isOpen,
  });
  const data = query.data;
  const memory = data?.memory;
  const label = `Memory pressure: ${query.status}`;
  const rate = (value: number | null | undefined) =>
    value == null ? "Unavailable" : `${formatMemoryBytes(value)}/s`;
  const metrics = [
    [
      "RAM used",
      formatMemoryBytes(data ? data.totalMemoryBytes - data.availableMemoryBytes : null),
    ],
    ["RAM total", formatMemoryBytes(data?.totalMemoryBytes)],
    ["Compressed memory", formatMemoryBytes(memory?.compressedBytes)],
    ["Wired memory", formatMemoryBytes(memory?.wiredBytes)],
    ["Swap used", formatMemoryBytes(memory?.swapUsedBytes)],
    ["Swap total", formatMemoryBytes(memory?.swapTotalBytes)],
    ["Swap read", rate(memory?.swapReadBytesPerSecond)],
    ["Swap write", rate(memory?.swapWriteBytesPerSecond)],
  ];
  return (
    <SidebarMenuItem className="shrink-0">
      <Popover open={visible && isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <SidebarMenuButton
                    aria-label={label}
                    data-testid="memory-sidebar-button"
                    size="icon"
                  >
                    <MemoryStickIcon className={statusColor[query.status]} />
                  </SidebarMenuButton>
                }
              />
            }
          />
          <TooltipPopup side="top">{label}</TooltipPopup>
        </Tooltip>
        <PopoverPopup align="start" side="top" width="sm" padding="compact">
          <div className="space-y-3 text-xs" data-testid="memory-sidebar-popover">
            <div className="space-y-1">
              <PopoverTitle>Memory pressure</PopoverTitle>
              <p className="break-words text-muted-foreground">
                {environment?.label ?? "No environment selected"}
              </p>
              <p className={statusColor[query.status]} role="status">
                {query.status}
              </p>
            </div>
            <dl className="space-y-1.5">
              {metrics.map(([name, value]) => (
                <div className="flex justify-between gap-3" key={name}>
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="text-right tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted-foreground">
              Sample:{" "}
              {data ? (
                <time dateTime={new Date(data.sampledAt).toISOString()}>
                  {new Date(data.sampledAt).toLocaleString()}
                </time>
              ) : (
                "Unavailable"
              )}
            </p>
            {query.isPending && data === null ? (
              <p className="text-muted-foreground">Reading memory…</p>
            ) : null}
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}
