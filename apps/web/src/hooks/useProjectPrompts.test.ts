import { describe, expect, it } from "vite-plus/test";

import { mergePromptsByName } from "./useProjectPrompts";

const command = (name: string, description: string) => ({ name, description });

describe("mergePromptsByName", () => {
  it("adds the repository's entries to the user's", () => {
    const merged = mergePromptsByName(
      [command("daily-update", "user")],
      [command("weekly-update", "project")],
    );

    expect(merged.map((entry) => entry.name).sort()).toEqual(["daily-update", "weekly-update"]);
  });

  it("lets the repository win a name it shares with the user", () => {
    // A repository that names a skill the user also names means the more
    // specific one, so it replaces rather than appearing twice.
    const merged = mergePromptsByName(
      [command("preflight", "user")],
      [command("preflight", "project")],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.description).toBe("project");
  });

  it("returns the user's list untouched when the repository holds none", () => {
    const fromUser = [command("daily-update", "user")];

    expect(mergePromptsByName(fromUser, [])).toBe(fromUser);
  });

  it("keeps a repository entry when the user has none at all", () => {
    const merged = mergePromptsByName([], [command("weekly-update", "project")]);

    expect(merged.map((entry) => entry.name)).toEqual(["weekly-update"]);
  });
});
