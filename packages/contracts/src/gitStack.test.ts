import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { GitStackError } from "./gitStack.ts";

describe("Git stack errors", () => {
  it.each([
    {
      _tag: "GitStackPreflightError",
      cwd: "/repo",
      reason: "dirty-worktree",
    },
    {
      _tag: "GitStackConflictError",
      cwd: "/repo",
      operation: "rebase",
    },
    {
      _tag: "GitStackCommandError",
      cwd: "/repo",
      operation: "view",
      exitCode: 1,
      stderrTail: "Command failed",
    },
  ])("preserves the $_tag error fields during serialization", (input) => {
    const error = Schema.decodeUnknownSync(GitStackError)(input);

    expect(error).toBeInstanceOf(Error);
    expect(error.message.length).toBeGreaterThan(0);
    expect(Schema.encodeSync(GitStackError)(error)).toEqual(input);
  });
});
