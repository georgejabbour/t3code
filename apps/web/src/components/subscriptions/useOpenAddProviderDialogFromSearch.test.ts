import { describe, expect, it } from "vite-plus/test";

import {
  addProviderDialogRequested,
  searchWithoutAddFlag,
} from "./useOpenAddProviderDialogFromSearch";

describe("addProviderDialogRequested", () => {
  it("accepts every form a router hands back for the flag", () => {
    // The router parses an address on its own. It answers with a boolean when
    // it knows the field, and with the raw text when it does not.
    expect(addProviderDialogRequested({ add: true })).toBe(true);
    expect(addProviderDialogRequested({ add: "true" })).toBe(true);
    expect(addProviderDialogRequested({ add: "1" })).toBe(true);
  });

  it("refuses an absent flag and every other value", () => {
    expect(addProviderDialogRequested({})).toBe(false);
    expect(addProviderDialogRequested({ add: false })).toBe(false);
    expect(addProviderDialogRequested({ add: "0" })).toBe(false);
    expect(addProviderDialogRequested({ add: 1 })).toBe(false);
  });
});

describe("searchWithoutAddFlag", () => {
  it("removes the flag and keeps the rest of the address", () => {
    expect(searchWithoutAddFlag({ add: "1", tab: "providers" })).toEqual({ tab: "providers" });
  });

  it("leaves an address that carries no flag alone", () => {
    expect(searchWithoutAddFlag({ tab: "providers" })).toEqual({ tab: "providers" });
  });
});
