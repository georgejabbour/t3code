import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  ClipboardApiUnavailableError,
  ClipboardWriteError,
  isClipboardWriteSupported,
  writeTextToClipboard,
} from "./useCopyToClipboard";

// The web unit suite runs under the node environment, so there is no DOM. The
// execCommand fallback needs one, and this builds the smallest document that
// exercises it.
function createFakeDocument(execCommandResult: boolean, activeElement: unknown = null) {
  const elements: Array<Record<string, unknown>> = [];
  const appended: Array<Record<string, unknown>> = [];
  const ranges: Array<Record<string, unknown>> = [];
  const fakeDocument = {
    activeElement,
    body: {
      appendChild: (node: Record<string, unknown>) => {
        appended.push(node);
        return node;
      },
    },
    execCommand: vi.fn(() => execCommandResult),
    createElement: () => {
      const element = {
        value: "",
        contentEditable: "inherit",
        style: { cssText: "" },
        setAttribute: vi.fn(),
        focus: vi.fn(),
        select: vi.fn(),
        setSelectionRange: vi.fn(),
        remove: vi.fn(),
      };
      elements.push(element);
      return element;
    },
    createRange: () => {
      const range = { selectNodeContents: vi.fn() };
      ranges.push(range);
      return range;
    },
  };
  return { appended, document: fakeDocument, elements, ranges };
}

function createFakeSelection(existingRange: unknown) {
  return {
    rangeCount: existingRange === null ? 0 : 1,
    getRangeAt: () => ({ cloneRange: () => existingRange }),
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
  };
}

const DESKTOP_NAVIGATOR = { userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 0 };
const IPHONE_NAVIGATOR = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
  maxTouchPoints: 5,
};

describe("writeTextToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports unavailable clipboard support with structural context", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});

    const error = await writeTextToClipboard("plan contents", "plan").then(
      () => undefined,
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(ClipboardApiUnavailableError);
    expect(error).toMatchObject({
      target: "plan",
    });
    expect((error as Error).message).not.toContain("plan contents");
  });

  it("preserves the exact clipboard failure without exposing copied contents", async () => {
    const cause = new Error("browser clipboard failure");
    const writeText = vi.fn().mockRejectedValue(cause);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const error = await writeTextToClipboard("secret clipboard contents", "error-message").then(
      () => undefined,
      (failure: unknown) => failure,
    );

    expect(writeText).toHaveBeenCalledWith("secret clipboard contents");
    expect(error).toBeInstanceOf(ClipboardWriteError);
    expect(error).toMatchObject({
      target: "error-message",
      cause,
    });
    expect((error as Error).message).not.toContain("secret clipboard contents");
  });

  it("keeps empty values as a no-op when clipboard support is available", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(writeTextToClipboard("", "plan")).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies through the execCommand fallback when the async clipboard API is missing", async () => {
    const { appended, document, elements } = createFakeDocument(true);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", DESKTOP_NAVIGATOR);
    vi.stubGlobal("document", document);

    await expect(writeTextToClipboard("terminal text", "terminal selection")).resolves.toBe(true);

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(appended).toHaveLength(1);
    expect(elements[0]?.value).toBe("terminal text");
    expect(elements[0]?.select).toHaveBeenCalled();
    expect(elements[0]?.remove).toHaveBeenCalled();
  });

  it("returns focus to the terminal input after the fallback copy", async () => {
    const focus = vi.fn();
    const { document } = createFakeDocument(true, { focus });
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", DESKTOP_NAVIGATOR);
    vi.stubGlobal("document", document);

    await expect(writeTextToClipboard("terminal text", "terminal selection")).resolves.toBe(true);

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("puts the page text selection back after the fallback copy", async () => {
    const existingRange = { id: "existing" };
    const selection = createFakeSelection(existingRange);
    const { document } = createFakeDocument(true);
    vi.stubGlobal("window", { getSelection: () => selection });
    vi.stubGlobal("navigator", DESKTOP_NAVIGATOR);
    vi.stubGlobal("document", document);

    await expect(writeTextToClipboard("terminal text", "terminal selection")).resolves.toBe(true);

    expect(selection.addRange).toHaveBeenLastCalledWith(existingRange);
  });

  it("selects through a document range on iOS, where a read-only textarea ignores select()", async () => {
    const selection = createFakeSelection(null);
    const { document, elements, ranges } = createFakeDocument(true);
    vi.stubGlobal("window", { getSelection: () => selection });
    vi.stubGlobal("navigator", IPHONE_NAVIGATOR);
    vi.stubGlobal("document", document);

    await expect(writeTextToClipboard("terminal text", "terminal selection")).resolves.toBe(true);

    expect(elements[0]?.contentEditable).toBe("true");
    expect(elements[0]?.select).not.toHaveBeenCalled();
    expect(elements[0]?.setSelectionRange).toHaveBeenCalledWith(0, "terminal text".length);
    expect(ranges[0]?.selectNodeContents).toHaveBeenCalledWith(elements[0]);
    expect(selection.addRange).toHaveBeenCalledWith(ranges[0]);
  });

  it("keeps empty values as a no-op when only the fallback is available", async () => {
    const { appended, document } = createFakeDocument(true);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", document);

    await expect(writeTextToClipboard("", "terminal selection")).resolves.toBe(false);

    expect(document.execCommand).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
  });

  it("reports a write failure when the fallback copy command refuses", async () => {
    const { document } = createFakeDocument(false);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", DESKTOP_NAVIGATOR);
    vi.stubGlobal("document", document);

    const error = await writeTextToClipboard("terminal text", "terminal selection").then(
      () => undefined,
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(ClipboardWriteError);
    expect(error).toMatchObject({
      target: "terminal selection",
    });
    expect((error as Error).message).not.toContain("terminal text");
  });

  it("retries with the fallback after the async clipboard write rejects", async () => {
    const { document } = createFakeDocument(true);
    const writeText = vi.fn().mockRejectedValue(new Error("Document is not focused"));
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { ...DESKTOP_NAVIGATOR, clipboard: { writeText } });
    vi.stubGlobal("document", document);

    await expect(writeTextToClipboard("terminal text", "terminal selection")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("terminal text");
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });
});

describe("isClipboardWriteSupported", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts the async clipboard API", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn() } });

    expect(isClipboardWriteSupported()).toBe(true);
  });

  it("accepts a plain-HTTP origin, where only the execCommand fallback exists", () => {
    const { document } = createFakeDocument(true);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", DESKTOP_NAVIGATOR);
    vi.stubGlobal("document", document);

    expect(isClipboardWriteSupported()).toBe(true);
  });

  it("rejects an environment with no clipboard path at all", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", DESKTOP_NAVIGATOR);

    expect(isClipboardWriteSupported()).toBe(false);
  });
});
