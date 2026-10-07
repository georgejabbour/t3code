import type { EnvironmentId, HostResourcesSnapshot } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";

const STALE_AFTER_MS = 65_000;

export function memoryPressureStatus(
  data: HostResourcesSnapshot | null,
  receivedAt: number,
  now: number,
  failed: boolean,
): "Normal" | "Warning" | "Critical" | "Unavailable" | "Stale" {
  if (data === null) return "Unavailable";
  // Receipt time avoids clock differences between the client and a remote server.
  if (failed || receivedAt <= 0 || now - receivedAt >= STALE_AFTER_MS) return "Stale";
  switch (data.memory?.pressure) {
    case "normal":
      return "Normal";
    case "warning":
      return "Warning";
    case "critical":
      return "Critical";
    default:
      return "Unavailable";
  }
}

export function formatMemoryBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return "Unavailable";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const exponent =
    value > 0 ? Math.max(0, Math.min(4, Math.floor(Math.log(value) / Math.log(1024)))) : 0;
  return `${(value / 1024 ** exponent).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[exponent]}`;
}

export function useHostResources(
  environmentId: EnvironmentId | null,
  { visible, connected, open }: { visible: boolean; connected: boolean; open: boolean },
) {
  const [documentVisible, setDocumentVisible] = useState(
    () => document.visibilityState === "visible",
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const enabled = visible && documentVisible && connected && environmentId !== null;
  const query = useEnvironmentQuery(
    enabled ? serverEnvironment.hostResources({ environmentId, input: {} }) : null,
  );
  const latest = useRef(query);
  useEffect(() => {
    latest.current = query;
  }, [query]);
  useEffect(() => {
    if (enabled && open && !latest.current.isPending) {
      latest.current.refresh();
    }
  }, [enabled, open]);
  useEffect(() => {
    if (!enabled || query.isPending) return;
    const refresh = () => {
      setNow(Date.now());
      if (!latest.current.isPending) latest.current.refresh();
    };
    // Start the next interval after completion, so it outlasts the server cache.
    const timer = setInterval(refresh, open ? 5_000 : 30_000);
    return () => clearInterval(timer);
  }, [enabled, open, query.isPending]);
  useEffect(() => {
    if (!enabled || query.dataUpdatedAt <= 0) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, query.dataUpdatedAt + STALE_AFTER_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [enabled, query.dataUpdatedAt]);
  return {
    ...query,
    status: memoryPressureStatus(
      query.data,
      query.dataUpdatedAt,
      Math.max(now, query.dataUpdatedAt),
      query.error !== null,
    ),
  };
}
