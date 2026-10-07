import { describe, expect, it } from "vite-plus/test";

import { cssFontFamilies, isFontFamilyAvailable, isMonospaceFamily } from "./appearanceFonts";

describe("cssFontFamilies", () => {
  it("maps installed iA font names to bundled families", () => {
    expect(cssFontFamilies('"iA Writer Quattro S", monospace')).toBe(
      '"iA Writer Quattro", monospace',
    );
    expect(cssFontFamilies("ia writer duo s")).toBe('"iA Writer Duo"');
  });
});

describe("bundled font availability", () => {
  it("accepts bundled fonts before their files load", () => {
    expect(isFontFamilyAvailable("iA Writer Quattro")).toBe(true);
    expect(isFontFamilyAvailable("iA Writer Duo S")).toBe(true);
    expect(isFontFamilyAvailable("Missing Font, iA Writer Duo")).toBe(true);
  });

  it("rejects bundled fonts for fixed-width surfaces before their files load", () => {
    expect(isMonospaceFamily("iA Writer Duo")).toBe(false);
    expect(isMonospaceFamily('"iA Writer Quattro S", monospace')).toBe(false);
  });
});
