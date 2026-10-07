// @effect-diagnostics nodeBuiltinImport:off - cleanup uses Node's retrying rm, which the FileSystem service does not expose.
import { vi } from "vite-plus/test";
import { assert, it } from "@effect/vitest";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSettings, ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { buildClaudeCapabilitiesProbeQueryOptions, probeClaudeWorkspaceSnapshot } from "./ClaudeProvider.ts";
import * as Schema from "effect/Schema";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

it("drops strict MCP mode, and only that, next to an administrator's managed-mcp.json", () => {
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    executablePath: "/usr/bin/claude",
    abortController: new AbortController(),
    environment: { HOME: "/home/user" },
    cwd: undefined,
    managedMcpConfig: true,
  });

  // Claude exits before initializing when handed --strict-mcp-config here.
  assert.equal(options.strictMcpConfig, undefined);
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
});

it.layer(NodeServices.layer)("Claude capability probe SDK boundary", (it) => {
  it.effect("isolates skills and commands for two Claude instances in the same workspace", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-instance-prompts-" });
      const cwd = path.join(root, "workspace");
      const configDirs = [path.join(root, "account-one"), path.join(root, "account-two")];
      for (const directory of [...configDirs, path.join(cwd, ".claude")]) {
        const skillDir = path.join(directory, "skills", "shared-name");
        yield* fs.makeDirectory(skillDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(skillDir, "SKILL.md"),
          `---\ndescription: ${directory}\n---\nUse the selected instance's skill.`,
        );
      }
      const unsupportedSkillDir = path.join(cwd, ".agents", "skills", "codex-only");
      yield* fs.makeDirectory(unsupportedSkillDir, { recursive: true });
      yield* fs.writeFileString(path.join(unsupportedSkillDir, "SKILL.md"), "Codex skill.");
      const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(({ options }) => {
        const index = configDirs.indexOf(options?.env?.CLAUDE_CONFIG_DIR ?? "");
        assert.notEqual(index, -1);
        assert.equal(options?.cwd, cwd);
        return {
          initializationResult: async () => ({
            commands: [
              {
                name: `account-${index + 1}-command`,
                description: "Account command",
                argumentHint: "",
              },
            ],
          }),
        } as ReturnType<typeof ClaudeSdk.query>;
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
      for (const [index, configDir] of configDirs.entries()) {
        const machineSnapshot = {
          instanceId: ProviderInstanceId.make(`claude-${index}`),
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          installed: true,
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-10-06T00:00:00.000Z",
          version: "2.1.288",
          models: [],
          slashCommands: [],
          skills: [],
        } satisfies ServerProvider;
        const snapshot = yield* probeClaudeWorkspaceSnapshot(
          decodeClaudeSettings({ homePath: configDir }),
          machineSnapshot,
          cwd,
        );
        assert.equal(snapshot.instanceId, machineSnapshot.instanceId);
        assert.deepEqual(
          snapshot.skills.map((skill) => skill.path),
          [path.join(configDir, "skills", "shared-name", "SKILL.md")],
        );
        assert.deepEqual(
          snapshot.slashCommands.map((command) => command.name),
          ["compact", `account-${index + 1}-command`],
        );
      }
    }).pipe(Effect.scoped),
  );

});
