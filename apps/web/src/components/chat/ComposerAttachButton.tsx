import { useRef } from "react";
import { PaperclipIcon } from "lucide-react";

import { ComposerControl, ComposerControlIcon } from "./ComposerControl";

/**
 * Read the chosen files from a file input and pass them on. A phone browser has
 * no drag-and-drop and no file paste, so this button is the only way a phone
 * user reaches the same attach path.
 *
 * The value reset lets the user pick the same file twice in a row. Without it
 * the browser skips the second `change` event, because the value did not change.
 */
export function selectImagesFromInputChange(
  target: { files: FileList | File[] | null; value: string },
  onFiles: (files: File[]) => void,
): void {
  const files = target.files ? Array.from(target.files) : [];
  if (files.length > 0) {
    onFiles(files);
  }
  target.value = "";
}

export function ComposerAttachButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          selectImagesFromInputChange(event.currentTarget, onFiles);
        }}
      />
      <ComposerControl
        type="button"
        aria-label="Attach images"
        title="Attach images"
        onClick={() => {
          inputRef.current?.click();
        }}
      >
        <ComposerControlIcon icon={PaperclipIcon} />
      </ComposerControl>
    </>
  );
}
