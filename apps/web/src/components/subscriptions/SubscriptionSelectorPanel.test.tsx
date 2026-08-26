import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  refreshQuery: vi.fn(),
  refreshServer: vi.fn(),
  selectorProps: null as null | {
    readonly onRefresh: () => void;
  },
}));

vi.mock("@effect/atom-react", () => ({
  useAtomRefresh: () => testState.refreshQuery,
  useAtomValue: (atom: string) =>
    atom === "subscription-usage"
      ? AsyncResult.success({ subscriptions: [] })
      : AsyncResult.success(null),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("~/state/server", () => ({
  serverEnvironment: {
    subscriptionUsage: () => "subscription-usage",
    subscriptionUsageHistory: () => "subscription-usage-history",
    refreshSubscriptionUsage: Symbol("refreshSubscriptionUsage"),
  },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: () => testState.refreshServer,
}));
vi.mock("./SubscriptionHistory", () => ({ SubscriptionHistory: () => null }));
vi.mock("./SubscriptionSelector", () => ({
  SubscriptionSelector: (props: NonNullable<typeof testState.selectorProps>) => {
    testState.selectorProps = props;
    return null;
  },
}));

import { SubscriptionSelectorPanel } from "./SubscriptionSelectorPanel";

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("SubscriptionSelectorPanel", () => {
  beforeEach(() => {
    testState.refreshQuery.mockReset();
    testState.refreshServer.mockReset();
    testState.selectorProps = null;
  });

  it("refreshes the displayed usage after the server refresh finishes", async () => {
    let finishServerRefresh: (() => void) | undefined;
    testState.refreshServer.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishServerRefresh = () => resolve(AsyncResult.success({ subscriptions: [] }));
        }),
    );

    renderToStaticMarkup(
      <SubscriptionSelectorPanel
        environmentId={EnvironmentId.make("environment-1")}
        activeInstanceId={null}
        onSelect={vi.fn()}
      />,
    );

    testState.selectorProps?.onRefresh();

    expect(testState.refreshServer).toHaveBeenCalledWith({
      environmentId: "environment-1",
      input: {},
    });
    expect(testState.refreshQuery).not.toHaveBeenCalled();

    finishServerRefresh?.();
    await flushPromises();

    expect(testState.refreshQuery).toHaveBeenCalledTimes(1);
  });
});
