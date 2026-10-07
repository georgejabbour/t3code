import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type SubscriptionUsageHistory,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
const state = vi.hoisted(() => ({
  config: null as { providers: ReadonlyArray<ServerProvider> } | null,
  configs: new Map<string, { providers: ReadonlyArray<ServerProvider> }>(),
  histories: new Map<string, SubscriptionUsageHistory>(),
  refreshHistory: vi.fn(),
  refreshProviders: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomRefresh: () => state.refreshHistory,
  useAtomValue: (atom: string) =>
    atom.startsWith("native-config:")
      ? (state.configs.get(atom) ?? state.config)
      : AsyncResult.success(state.histories.get(atom) ?? { peaks: [] }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("~/state/server", () => ({
  serverEnvironment: {
    configValueAtom: (environmentId: string | null) => `native-config:${environmentId ?? "none"}`,
    subscriptionUsageHistory: ({ environmentId }: { environmentId: string }) =>
      `quota-history:${environmentId}`,
    refreshProviders: Symbol("refreshProviders"),
  },
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.refreshProviders }));
vi.mock("../ui/tooltip", async () => {
  const { cloneElement, isValidElement } = await import("react");
  return {
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger({
      render,
      children,
    }: ComponentProps<typeof import("../ui/tooltip").TooltipTrigger>) {
      if (!isValidElement(render)) return <>{children}</>;
      return children === undefined ? render : cloneElement(render, undefined, children);
    },
    TooltipPopup: () => null,
  };
});
import { SubscriptionSelectorPanel } from "./SubscriptionSelectorPanel";
const checkedAt = "2026-10-01T12:00:00.000Z";
const provider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  displayName: "Codex account",
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated", email: "me@example.com" },
  checkedAt,
  models: [],
  skills: [],
  slashCommands: [],
  usageLimits: {
    checkedAt,
    windows: [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 23 }],
  },
  ...overrides,
});
let renderer: ReactTestRenderer | undefined;
const total = () =>
  renderer!.root.findByProps({ "data-testid": "subscription-total-remaining" }).children.join("");
const mount = async (id: string | null = "native-popover") => {
  await act(async () => {
    renderer = create(
      <SubscriptionSelectorPanel
        environmentId={id === null ? null : EnvironmentId.make(id)}
        activeInstanceId="codex"
        onSelect={vi.fn()}
      />,
    );
  });
};
describe("native subscription popover", () => {
  beforeEach(() => {
    state.config = { providers: [provider()] };
    state.configs.clear();
    state.histories.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-06T12:00:00.000Z"));
    state.refreshHistory.mockReset();
    state.refreshProviders.mockReset();
    state.navigate.mockReset();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { setInterval, clearInterval });
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("draws native quota changes and keeps disabled accounts visible", async () => {
    state.config = {
      providers: [
        provider(),
        provider({ instanceId: ProviderInstanceId.make("off"), enabled: false }),
      ],
    };
    await mount();
    expect(total()).toBe("77%");
    await act(async () =>
      renderer!.root.findByProps({ "data-testid": "subscription-row-off" }).props.onClick(),
    );
    expect(state.navigate).toHaveBeenCalledWith({ to: "/settings/providers" });
    state.config = {
      providers: [
        provider({
          usageLimits: {
            checkedAt: "2026-10-01T12:01:00.000Z",
            windows: [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 34 }],
          },
        }),
      ],
    };
    await act(async () =>
      renderer!.update(
        <SubscriptionSelectorPanel
          environmentId={EnvironmentId.make("native-popover")}
          activeInstanceId="codex"
          onSelect={vi.fn()}
        />,
      ),
    );
    expect(total()).toBe("66%");
    expect(state.refreshHistory).toHaveBeenCalledTimes(2);
    expect(state.refreshProviders).not.toHaveBeenCalled();
  });
  it("keeps bars during native refresh and reads history after completion", async () => {
    let finish: (() => void) | undefined;
    state.refreshProviders.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await mount("refresh-popover");
    state.refreshHistory.mockClear();
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = renderer!.root
        .findByProps({ "aria-label": "Refresh subscription usage" })
        .props.onClick();
      await Promise.resolve();
    });
    expect(state.refreshProviders).toHaveBeenCalledWith({
      environmentId: "refresh-popover",
      input: {},
    });
    expect(total()).toBe("77%");
    expect(
      renderer!.root.findByProps({ "aria-label": "Reading subscription usage" }).props.disabled,
    ).toBe(true);
    expect(state.refreshHistory).not.toHaveBeenCalled();
    await act(async () => {
      finish?.();
      await pending;
    });
    expect(state.refreshHistory).toHaveBeenCalledTimes(1);
    expect(
      renderer!.root.findByProps({ "aria-label": "Refresh subscription usage" }).props.disabled,
    ).toBe(false);
  });
  it("retains the last bars when a native refresh reports failure", async () => {
    state.refreshProviders.mockResolvedValue({ _tag: "Failure" });
    await mount("failed-refresh-popover");
    await act(async () => {
      await renderer!.root
        .findByProps({ "aria-label": "Refresh subscription usage" })
        .props.onClick();
    });
    expect(total()).toBe("77%");
    expect(
      renderer!.root.findByProps({ "aria-label": "Refresh subscription usage" }).props.disabled,
    ).toBe(false);
  });
  it("does not send a refresh when no environment is selected", async () => {
    state.config = null;
    await mount(null);
    await act(async () => {
      await renderer!.root
        .findByProps({ "aria-label": "Refresh subscription usage" })
        .props.onClick();
    });
    expect(state.refreshProviders).not.toHaveBeenCalled();
    expect(
      renderer!.root.findAllByProps({ "data-testid": "subscription-total-remaining" }),
    ).toHaveLength(0);
  });
  it("uses the counted account's latest timestamp for freshness", async () => {
    state.config = {
      providers: [
        provider(),
        provider({
          instanceId: ProviderInstanceId.make("same-account"),
          usageLimits: {
            checkedAt: "2026-10-06T12:00:00.000Z",
            windows: [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 40 }],
          },
        }),
      ],
    };
    await mount("freshness-popover");
    expect(total()).toBe("60%");
    expect(
      renderer!.root.findByProps({ "data-testid": "subscription-selector" }).props[
        "data-freshness"
      ],
    ).toBe("fresh");
  });
  it("switches environment readings and preserves separate earlier history", async () => {
    const peak = {
      instanceId: ProviderInstanceId.make("codex"),
      window: "weekly",
      accountKey: "codex:me@example.com",
      label: "Weekly windows",
      resetsAt: "2026-10-02T12:00:00.000Z",
      peakUtilization: 99,
      firstSampledAt: checkedAt,
      lastSampledAt: checkedAt,
      sampleCount: 2,
    };
    state.configs.set("native-config:local", { providers: [provider()] });
    state.configs.set("native-config:remote", {
      providers: [
        provider({
          usageLimits: {
            checkedAt,
            windows: [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 80 }],
          },
        }),
      ],
    });
    state.histories.set("quota-history:local", {
      peaks: [peak, { ...peak, accountKey: undefined, window: "sevenDay", peakUtilization: 20 }],
    });
    await mount("local");
    expect(total()).toBe("77%");
    const content = JSON.stringify(renderer!.toJSON());
    expect(content).toContain("Earlier weekly windows");
    expect(content).toContain("Weekly windows");
    expect(content).toContain("ran out in 1 of the last 1");
    expect(content).toContain("none of the last 1 ran out");
    await act(async () =>
      renderer!.update(
        <SubscriptionSelectorPanel
          environmentId={EnvironmentId.make("remote")}
          activeInstanceId="codex"
          onSelect={vi.fn()}
        />,
      ),
    );
    expect(total()).toBe("20%");
    expect(renderer!.root.findAllByProps({ "data-testid": "subscription-history" })).toHaveLength(
      0,
    );
    state.refreshProviders.mockResolvedValue({ _tag: "Success" });
    await act(async () => {
      await renderer!.root
        .findByProps({ "aria-label": "Refresh subscription usage" })
        .props.onClick();
    });
    expect(state.refreshProviders).toHaveBeenCalledWith({ environmentId: "remote", input: {} });
  });
});
