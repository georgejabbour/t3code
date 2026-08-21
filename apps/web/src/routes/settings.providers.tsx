import { createFileRoute } from "@tanstack/react-router";

import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";

function SettingsProvidersRoute() {
  return <ProviderSettingsPanel />;
}

export const Route = createFileRoute("/settings/providers")({
  component: SettingsProvidersRoute,
  // Added by this fork. `?add=1` opens the add-provider dialog on arrival, so
  // "Add another subscription" in the subscription panel lands on the form
  // rather than on a screen the reader has to search. See PATCHES.md.
  validateSearch: (search: Record<string, unknown>): { readonly add?: boolean } =>
    search.add === true || search.add === "true" || search.add === "1" ? { add: true } : {},
});
