// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, it, assert } from "@effect/vitest";

import { describeUnusableSessionCwd } from "./SessionWorkingDirectory.ts";

const makeTempDir = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-session-cwd-"));

describe("describeUnusableSessionCwd", () => {
  it("accepts a folder that exists", () => {
    const dir = makeTempDir();
    try {
      assert.equal(describeUnusableSessionCwd(dir), undefined);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names the deleted folder when a worktree is removed under a live thread", () => {
    const dir = makeTempDir();
    NodeFS.rmSync(dir, { recursive: true, force: true });

    const issue = describeUnusableSessionCwd(dir);

    assert.isString(issue);
    assert.include(issue ?? "", dir);
    assert.include(issue ?? "", "no longer exists");
  });

  it("rejects a path that points at a file", () => {
    const dir = makeTempDir();
    const file = NodePath.join(dir, "not-a-folder.txt");
    NodeFS.writeFileSync(file, "");
    try {
      const issue = describeUnusableSessionCwd(file);

      assert.isString(issue);
      assert.include(issue ?? "", file);
      assert.include(issue ?? "", "not a folder");
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a symbolic link whose target is gone", () => {
    const dir = makeTempDir();
    const link = NodePath.join(dir, "link");
    NodeFS.symlinkSync(NodePath.join(dir, "gone"), link);
    try {
      const issue = describeUnusableSessionCwd(link);

      assert.isString(issue);
      assert.include(issue ?? "", "no longer exists");
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
