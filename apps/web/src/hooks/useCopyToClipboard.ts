import * as React from "react";
import * as Schema from "effect/Schema";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextClipboardHtml,
} from "@t3tools/shared/composerContextClipboard";

export class ClipboardApiUnavailableError extends Schema.TaggedError<ClipboardApiUnavailableError>()(
  "ClipboardApiUnavailableError",
  {
    target: Schema.String,
  },
) {
  override get message(): string {
    return `Clipboard API is unavailable while copying ${this.target}.`;
  }
}

export class ClipboardWriteError extends Schema.TaggedError<ClipboardWriteError>()(
  "ClipboardWriteError",
  {
    target: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to copy ${this.target} to the clipboard.`;
  }
}

export class ClipboardReadUnavailableError extends Schema.TaggedError<ClipboardReadUnavailableError>()(
  "ClipboardReadUnavailableError",
  {
    target: Schema.String,
  },
) {
  override get message(): string {
    return `Clipboard API is unavailable while reading ${this.target}.`;
  }
}

export class ClipboardReadError extends Schema.TaggedError<ClipboardReadError>()(
  "ClipboardReadError",
  {
    target: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read ${this.target} from the clipboard.`;
  }
}

// A fixed 1px box at the viewport origin. The element needs layout to be
// selectable — display:none and visibility:hidden both block selection — and a
// fixed position cannot move the page scroll. The 16px font size stops iOS
// Safari from zooming the page when the field takes focus.
const CLIPBOARD_FALLBACK_STYLE =
  "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;margin:0;" +
  "outline:0;box-shadow:none;background:transparent;opacity:0;z-index:-1;font-size:16px;";

function isIosLikeBrowser(): boolean {
  // iPadOS 13 and later report "Macintosh", so also test the touch points.
  const userAgent = navigator.userAgent ?? "";
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && (navigator.maxTouchPoints ?? 0) > 1)
  );
}

/**
 * Clipboard write for origins that are not secure contexts — a plain-HTTP LAN
 * or tailnet host name, for example — where the browser never creates
 * `navigator.clipboard`.
 *
 * Every statement here runs synchronously on purpose. The browser only lets
 * `document.execCommand("copy")` write while the user gesture that started the
 * call is still active, so a single `await` before this point loses the copy.
 */
function copyTextWithExecCommand(
  value: string,
  target: string,
  extraFlavors?: Readonly<Record<string, string>>,
): boolean {
  if (
    typeof document === "undefined" ||
    typeof document.execCommand !== "function" ||
    document.body == null
  ) {
    throw new ClipboardApiUnavailableError({ target });
  }

  // The terminal keeps the keyboard on a hidden textarea (see
  // terminal/ghostty/surface.ts). The temporary element below takes that focus
  // away, so remember the holder and give the focus back in the finally block.
  // The focus call is duck-typed because HTMLElement does not exist under the
  // node test environment.
  const previousActiveElement = document.activeElement as
    | (Element & { focus?: (options?: FocusOptions) => void })
    | null;
  const selection = window.getSelection?.() ?? null;
  const previousRanges: Range[] = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      previousRanges.push(selection.getRangeAt(index).cloneRange());
    }
  }

  // A textarea holds the string byte for byte. A contenteditable div lets the
  // browser normalize the white space, which would corrupt a terminal selection
  // with its newlines and leading spaces.
  const element = document.createElement("textarea");
  element.value = value;
  element.setAttribute("readonly", ""); // keeps the iOS software keyboard shut
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("tabindex", "-1");
  element.style.cssText = CLIPBOARD_FALLBACK_STYLE;
  const copy = (event: ClipboardEvent) => {
    if (!extraFlavors || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", value);
    for (const [type, data] of Object.entries(extraFlavors)) {
      event.clipboardData.setData(type, data);
    }
    event.preventDefault();
  };
  document.body.appendChild(element);
  element.addEventListener("copy", copy);

  let copied = false;
  let failure: unknown = null;
  try {
    if (isIosLikeBrowser()) {
      // iOS Safari ignores select() on a read-only textarea. It needs a
      // document range plus setSelectionRange to accept the selection.
      element.contentEditable = "true";
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.setSelectionRange(0, value.length);
    } else {
      element.focus({ preventScroll: true });
      element.select();
      element.setSelectionRange(0, value.length);
    }
    copied = document.execCommand("copy");
  } catch (cause) {
    failure = cause;
  } finally {
    element.removeEventListener("copy", copy);
    element.remove();
    if (selection) {
      // Firefox drops the page text selection when a textarea takes it, and the
      // iOS branch above replaces it on purpose. Both need it put back.
      selection.removeAllRanges();
      for (const range of previousRanges) selection.addRange(range);
    }
    previousActiveElement?.focus?.({ preventScroll: true });
  }

  if (!copied) {
    // A false return means the browser refused the write. That is a write
    // failure, not a missing API.
    throw new ClipboardWriteError({
      target,
      cause: failure ?? new Error('document.execCommand("copy") returned false'),
    });
  }
  return true;
}

/** True when either clipboard path can write on this origin. */
export function isClipboardWriteSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (navigator.clipboard?.writeText != null) return true;
  return typeof document !== "undefined" && typeof document.execCommand === "function";
}

export async function writeTextToClipboard(
  value: string,
  target = "text",
  extraFlavors?: Readonly<Record<string, string>>,
): Promise<boolean> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    throw new ClipboardApiUnavailableError({
      target,
    });
  }

  if (!value) return false;
  if (extraFlavors) {
    extraFlavors = Object.fromEntries(
      Object.entries(extraFlavors).filter(([type]) => type !== "text/plain"),
    );
  }
  const contextFragment = extraFlavors?.[COMPOSER_CONTEXT_CLIPBOARD_MIME];
  if (contextFragment)
    extraFlavors = {
      ...extraFlavors,
      // A caller that already built rich HTML keeps it; the escaped `<pre>` is only a fallback.
      "text/html": encodeComposerContextClipboardHtml(
        value,
        contextFragment,
        extraFlavors?.["text/html"],
      ),
    };

  // A plain-HTTP origin is not a secure context, so `navigator.clipboard` does
  // not exist there. Go straight to the synchronous fallback: an await here
  // would end the user gesture that document.execCommand("copy") needs.
  if (!navigator.clipboard?.writeText) {
    return copyTextWithExecCommand(value, target, extraFlavors);
  }

  try {
    // Custom flavors need ClipboardItem; when it is missing or refuses the type, plain text
    // still lands so the copy never silently fails.
    if (extraFlavors && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([value], { type: "text/plain" }),
            ...Object.fromEntries(
              Object.entries(extraFlavors).map(([type, data]) => [
                type,
                new Blob([data], { type }),
              ]),
            ),
          }),
        ]);
        return true;
      } catch {
        // Safari/native bridges may accept HTML but reject Chromium's custom web flavor.
        const html = extraFlavors["text/html"];
        if (html) {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({
                "text/plain": new Blob([value], { type: "text/plain" }),
                "text/html": new Blob([html], { type: "text/html" }),
              }),
            ]);
            return true;
          } catch {
            // Plain text still makes unavailable references visible to the receiver.
          }
        }
      }
    }
    await navigator.clipboard.writeText(value);
    return true;
  } catch (cause) {
    // Best effort only. Chromium keeps the user gesture across a promise turn,
    // so this rescues a denied write there. WebKit and Gecko tie the gesture to
    // the call stack and may refuse, which leaves the original failure.
    try {
      return copyTextWithExecCommand(value, target, extraFlavors);
    } catch {
      throw new ClipboardWriteError({
        target,
        cause,
      });
    }
  }
}

export async function readTextFromClipboard(target = "text"): Promise<string> {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !navigator.clipboard?.readText
  ) {
    throw new ClipboardReadUnavailableError({
      target,
    });
  }

  try {
    return await navigator.clipboard.readText();
  } catch (cause) {
    throw new ClipboardReadError({
      target,
      cause,
    });
  }
}

export function useCopyToClipboard<TContext = void>({
  timeout = 2000,
  target = "text",
  onCopy,
  onError,
  extraFlavors,
}: {
  timeout?: number;
  target?: string;
  onCopy?: (ctx: TContext) => void;
  onError?: (error: Error, ctx: TContext) => void;
  extraFlavors?: Readonly<Record<string, string>>;
} = {}): { copyToClipboard: (value: string, ctx: TContext) => void; isCopied: boolean } {
  const [isCopied, setIsCopied] = React.useState(false);
  const timeoutIdRef = React.useRef<NodeJS.Timeout | null>(null);
  const onCopyRef = React.useRef(onCopy);
  const onErrorRef = React.useRef(onError);
  const targetRef = React.useRef(target);
  const timeoutRef = React.useRef(timeout);

  onCopyRef.current = onCopy;
  onErrorRef.current = onError;
  const extraFlavorsRef = React.useRef(extraFlavors);
  targetRef.current = target;
  timeoutRef.current = timeout;
  extraFlavorsRef.current = extraFlavors;

  const copyToClipboard = React.useCallback((value: string, ctx: TContext): void => {
    void writeTextToClipboard(value, targetRef.current, extraFlavorsRef.current).then(
      (didCopy) => {
        if (!didCopy) return;
        if (timeoutIdRef.current) {
          clearTimeout(timeoutIdRef.current);
        }
        setIsCopied(true);

        onCopyRef.current?.(ctx);

        if (timeoutRef.current !== 0) {
          timeoutIdRef.current = setTimeout(() => {
            setIsCopied(false);
            timeoutIdRef.current = null;
          }, timeoutRef.current);
        }
      },
      (error) => {
        console.error(error);
        onErrorRef.current?.(error, ctx);
      },
    );
  }, []);

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return (): void => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
      }
    };
  }, []);

  return { copyToClipboard, isCopied };
}
