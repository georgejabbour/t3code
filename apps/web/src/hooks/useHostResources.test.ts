import { EnvironmentId, type HostResourcesSnapshot } from "@t3tools/contracts";
import { act, createElement, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { formatMemoryBytes, memoryPressureStatus, useHostResources } from "./useHostResources";

const state = vi.hoisted(() => ({
  data: null as HostResourcesSnapshot | null,
  pending: false,
  refresh: vi.fn(),
}));

vi.mock("~/state/server", () => ({
  serverEnvironment: { hostResources: (target: { environmentId: string }) => target.environmentId },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (environmentId: string | null) => ({
    data: environmentId === "first" ? state.data : null,
    dataUpdatedAt: environmentId === "first" && state.data ? 1_000_000 : 0,
    error: null,
    isPending: state.pending,
    refresh: state.refresh,
  }),
}));

const snapshot = {
  sampledAt: 100,
  cpuUtilization: null,
  cpuCount: 8,
  availableMemoryBytes: 1024,
  totalMemoryBytes: 2048,
  memory: {
    pressure: "warning",
    compressedBytes: null,
    wiredBytes: null,
    swapUsedBytes: null,
    swapTotalBytes: null,
    swapReadBytesPerSecond: null,
    swapWriteBytesPerSecond: null,
  },
} satisfies HostResourcesSnapshot;

describe("sidebar host resources", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    state.refresh.mockClear();
    state.pending = false;
    state.data = null;
  });

  it("formats fractional rates, zero values, binary units, and unavailable metrics", () => {
    expect(formatMemoryBytes(0.5)).toBe(`${(0.5).toLocaleString()} B`);
    expect(formatMemoryBytes(0)).toBe("0 B");
    expect(formatMemoryBytes(1024)).toBe("1 KiB");
    expect(formatMemoryBytes(1024 ** 3)).toBe("1 GiB");
    expect(formatMemoryBytes(null)).toBe("Unavailable");
    expect(formatMemoryBytes(undefined)).toBe("Unavailable");
  });

  it("uses client receipt time for remote hosts and maps pressure states", () => {
    expect(memoryPressureStatus(snapshot, 1_000_000, 1_001_000, false)).toBe("Warning");
    expect(
      memoryPressureStatus(
        { ...snapshot, memory: { ...snapshot.memory, pressure: "normal" } },
        1_000_000,
        1_001_000,
        false,
      ),
    ).toBe("Normal");
    expect(
      memoryPressureStatus(
        { ...snapshot, memory: { ...snapshot.memory, pressure: "critical" } },
        1_000_000,
        1_001_000,
        false,
      ),
    ).toBe("Critical");
  });

  it("keeps missing, unsupported, stale, and failed readings neutral", () => {
    expect(memoryPressureStatus(null, 0, 100_000, false)).toBe("Unavailable");
    const { memory, ...legacy } = snapshot;
    expect(memoryPressureStatus(legacy, 100_000, 100_000, false)).toBe("Unavailable");
    expect(
      memoryPressureStatus(
        { ...snapshot, memory: { ...memory, pressure: null } },
        100_000,
        100_000,
        false,
      ),
    ).toBe("Unavailable");
    expect(memoryPressureStatus(snapshot, 100_000, 164_999, false)).toBe("Warning");
    expect(memoryPressureStatus(snapshot, 100_000, 165_000, false)).toBe("Stale");
    expect(memoryPressureStatus(snapshot, 100_000, 100_000, true)).toBe("Stale");
    expect(memoryPressureStatus(snapshot, 0, 100_000, false)).toBe("Stale");
  });

  it("polls at both intervals, skips pending reads, and pauses when hidden or disconnected", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.data = snapshot;
    let renderer: ReactTestRenderer | undefined;
    let view: ReturnType<typeof useHostResources> | undefined;
    function Probe({ environmentId = "first", visible = true, connected = true, open = false }) {
      const result = useHostResources(EnvironmentId.make(environmentId), {
        visible,
        connected,
        open,
      });
      useEffect(() => {
        view = result;
      }, [result]);
      return null;
    }
    const update = (props: Parameters<typeof Probe>[0]) =>
      act(() => renderer?.update(createElement(Probe, props)));
    const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
    try {
      act(() => {
        renderer = create(createElement(Probe, {}));
      });
      advance(29_999);
      expect(state.refresh).toHaveBeenCalledTimes(0);
      advance(1);
      expect(state.refresh).toHaveBeenCalledTimes(1);
      update({ open: true });
      expect(state.refresh).toHaveBeenCalledTimes(2);
      advance(5_000);
      expect(state.refresh).toHaveBeenCalledTimes(3);
      state.pending = true;
      update({ open: true });
      advance(30_000);
      expect(state.refresh).toHaveBeenCalledTimes(3);
      expect(view?.status).toBe("Stale");
      state.pending = false;
      update({ open: true });
      document.visibilityState = "hidden";
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      advance(60_000);
      expect(state.refresh).toHaveBeenCalledTimes(3);
      expect(view?.data).toBeNull();
      document.visibilityState = "visible";
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      expect(state.refresh).toHaveBeenCalledTimes(4);
      update({ open: true, connected: false });
      advance(60_000);
      expect(state.refresh).toHaveBeenCalledTimes(4);
      expect(view?.status).toBe("Unavailable");
      update({ visible: false });
      advance(60_000);
      expect(state.refresh).toHaveBeenCalledTimes(4);
      update({ environmentId: "second" });
      expect(view?.data).toBeNull();
      expect(view?.status).toBe("Unavailable");
    } finally {
      act(() => renderer?.unmount());
    }
  });
});
