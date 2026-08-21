/**
 * useOpenAddProviderDialogFromSearch - land on the add-provider form.
 *
 * "Add another subscription" in the subscription panel sends a reader to the
 * Providers screen. Without this hook that reader arrives on a long screen and
 * has to find the small plus button themselves, which is the step that made
 * adding a second sign-in feel out of reach.
 *
 * The panel sends `?add=1`. This hook opens the dialog once, then clears the
 * value from the address so a page reload, a step backwards, or a shared link
 * does not open the dialog a second time.
 *
 * This fork keeps its additions in new files, so an upstream change rarely
 * conflicts with them.
 *
 * @module useOpenAddProviderDialogFromSearch
 */
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/** Reads `?add=1` on the Providers screen and opens the dialog once. */
export function useOpenAddProviderDialogFromSearch(setOpen: (open: boolean) => void): void {
  const navigate = useNavigate();
  const location = useLocation();
  // Read through the location rather than a typed route hook, so this works
  // wherever the panel is mounted, including inside the settings dialog.
  const search = location.search as { readonly add?: unknown };
  const shouldOpen = search.add === true || search.add === "true" || search.add === "1";

  useEffect(() => {
    if (!shouldOpen) {
      return;
    }
    setOpen(true);
    void navigate({
      to: location.pathname,
      search: (current: Record<string, unknown>) => {
        const { add: _add, ...rest } = current;
        return rest;
      },
      replace: true,
    });
    // The effect runs on the flag alone. Listing `navigate` or the path would
    // re-run it after the address is cleared, which reopens a dialog the
    // reader has just closed.
  }, [shouldOpen]);
}
