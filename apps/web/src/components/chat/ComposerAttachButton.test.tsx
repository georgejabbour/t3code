import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerAttachButton, selectImagesFromInputChange } from "./ComposerAttachButton";

function imageFile(name: string): File {
  return new File(["x"], name, { type: "image/png" });
}

describe("selectImagesFromInputChange", () => {
  it("forwards the chosen files to the handler", () => {
    const onFiles = vi.fn();
    const file = imageFile("a.png");

    selectImagesFromInputChange({ files: [file], value: "C:\\fakepath\\a.png" }, onFiles);

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("clears the input value so the same file fires change again", () => {
    const target = { files: [imageFile("a.png")], value: "C:\\fakepath\\a.png" };

    selectImagesFromInputChange(target, vi.fn());

    expect(target.value).toBe("");
  });

  it("does not call the handler for an empty selection", () => {
    const onFiles = vi.fn();
    const target = { files: [] as File[], value: "" };

    selectImagesFromInputChange(target, onFiles);

    expect(onFiles).not.toHaveBeenCalled();
  });
});

describe("ComposerAttachButton", () => {
  it("renders a hidden image file input that accepts several files", () => {
    const markup = renderToStaticMarkup(createElement(ComposerAttachButton, { onFiles: () => {} }));

    expect(markup).toContain('type="file"');
    expect(markup).toContain('accept="image/*"');
    expect(markup).toContain("multiple");
    expect(markup).toContain('aria-label="Attach images"');
  });
});
