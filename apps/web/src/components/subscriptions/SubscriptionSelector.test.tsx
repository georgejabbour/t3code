import {
  ProviderDriverKind,
  ProviderInstanceId,
  type SubscriptionUsageList,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

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
