import {
  ProviderDriverKind,
  ProviderInstanceId,
  type SubscriptionUsageList,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

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

import { SubscriptionSelector } from "./SubscriptionSelector";

const usage: SubscriptionUsageList = {
  subscriptions: [
    {
      instanceId: ProviderInstanceId.make("personal"),
      driver: ProviderDriverKind.make("claudeAgent"),
      enabled: true,
      displayName: "Personal",
      accentColor: "#d97757",
      email: null,
      subscriptionType: "max",
      fiveHour: { label: "5h", utilization: 9, resetsAt: null },
      sevenDay: { label: "Week", utilization: 20, resetsAt: null },
      absence: null,
      collectedAt: "2026-08-28T12:00:00.000Z",
    },
  ],
};

describe("SubscriptionSelector limit bars", () => {
  it("hides email labels until requested and keeps subscription selection separate", async () => {
    const email = "personal@example.com";
    const onSelect = vi.fn();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { setInterval, clearInterval });
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          <SubscriptionSelector
            usage={{ subscriptions: [{ ...usage.subscriptions[0]!, displayName: email }] }}
            isRevalidating={false}
            updatedAtMs={null}
            activeInstanceId="personal"
            onSelect={onSelect}
            onRefresh={() => {}}
            onAddSubscription={() => {}}
            onManageSubscription={() => {}}
          />,
        );
      });
      const mounted = renderer!;
      expect(JSON.stringify(mounted.toJSON())).not.toContain(email);
      const reveal = mounted.root.findByProps({ "aria-label": "Toggle account label visibility" });
      await act(async () => reveal.props.onClick());
      expect(JSON.stringify(mounted.toJSON())).toContain(email);
      expect(onSelect).not.toHaveBeenCalled();
      await act(async () => reveal.props.onClick());
      expect(JSON.stringify(mounted.toJSON())).not.toContain(email);
      await act(async () => {
        mounted.root.findByProps({ "data-testid": "subscription-row-personal" }).props.onClick();
      });
      expect(onSelect).toHaveBeenCalledExactlyOnceWith("personal");
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("divides the five-hour bar into hours and the weekly bar into days", () => {
    const markup = renderToStaticMarkup(
      <SubscriptionSelector
        usage={usage}
        isRevalidating={false}
        updatedAtMs={null}
        activeInstanceId="personal"
        onSelect={() => {}}
        onRefresh={() => {}}
        onAddSubscription={() => {}}
        onManageSubscription={() => {}}
      />,
    );

    const hourMarks = markup.match(/data-testid="subscription-session-hour-mark"/gu) ?? [];
    const dayMarks = markup.match(/data-testid="subscription-week-day-mark"/gu) ?? [];
    expect(hourMarks).toHaveLength(4);
    expect(dayMarks).toHaveLength(6);
    for (const position of [20, 40, 60, 80]) {
      expect(markup).toContain(`left:${position}%`);
    }
    for (const day of [1, 2, 3, 4, 5, 6]) {
      expect(markup).toContain(`left:${(day / 7) * 100}%`);
    }
  });
});
