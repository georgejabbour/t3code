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

/** True when the address asks for the add-provider dialog. */
export function addProviderDialogRequested(search: { readonly add?: unknown }): boolean {
  return search.add === true || search.add === "true" || search.add === "1";
}

/** The same address, with the one-shot `add` flag removed. */
export function searchWithoutAddFlag(search: Record<string, unknown>): Record<string, unknown> {
  const { add: _add, ...rest } = search;
  return rest;
}

/** Reads `?add=1` on the Providers screen and opens the dialog once. */
export function useOpenAddProviderDialogFromSearch(setOpen: (open: boolean) => void): void {
  const navigate = useNavigate();
  const location = useLocation();
  // Read through the location rather than a typed route hook, so this works
  // wherever the panel is mounted, including inside the settings dialog.
  const shouldOpen = addProviderDialogRequested(location.search as { readonly add?: unknown });

  useEffect(() => {
    if (!shouldOpen) {
      return;
    }
    setOpen(true);
    void navigate({
      to: location.pathname,
      search: searchWithoutAddFlag,
      replace: true,
    });
    // The effect runs on the flag alone. Listing `navigate` or the path would
    // re-run it after the address is cleared, which reopens a dialog the
    // reader has just closed.
  }, [shouldOpen]);
}

/**
 * OpenAddProviderDialogFromSearch - the hook above, mounted as a child.
 *
 * An upstream unit test calls the provider settings panel as a plain
 * function. It supplies stand-ins for four React hooks and no router, so any
 * further hook in the panel's own body stops that test. This element does not
 * run in it, because the test reads the element tree the panel returns and
 * never renders it. In the running app the element mounts with the panel, so
 * a reader sees the same dialog at the same moment as before.
 */
export function OpenAddProviderDialogFromSearch({
  onOpen,
}: {
  readonly onOpen: (open: boolean) => void;
}): null {
  useOpenAddProviderDialogFromSearch(onOpen);
  return null;
}
