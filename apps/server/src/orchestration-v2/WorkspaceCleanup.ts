import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type { TerminalSummary } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { canonicalPath } from "../project/ManagedWorktree.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import { withWorkspaceLeases, workspacesOverlap } from "../workspace/workspaceLease.ts";
import type { OrchestrationEffectV2 } from "./EffectOutbox.ts";
import * as ProjectStore from "./ProjectStore.ts";

export class WorkspaceCleanupError extends Schema.TaggedError<WorkspaceCleanupError>()(
  "WorkspaceCleanupError",
  {
    effectId: Schema.String,
    reason: Schema.Literals(["state", "path", "busy", "command", "timeout"]),
    exitCode: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Workspace cleanup failed (${this.reason})${this.exitCode === undefined ? "" : `, exit code ${this.exitCode}`}.`;
  }
}

const isWorkspaceCleanupError = Schema.is(WorkspaceCleanupError);

export class WorkspaceCleanup extends Context.Service<
  WorkspaceCleanup,
  {
    readonly execute: (
      effect: OrchestrationEffectV2,
      options?: { readonly dryRun?: boolean },
    ) => Effect.Effect<void, WorkspaceCleanupError>;
  }
>()("t3/orchestration-v2/WorkspaceCleanup") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const loader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
  const processes = yield* ProcessRunner.ProcessRunner;
  const terminals = yield* TerminalManager.TerminalManager;
  const liveTerminals = new Map<string, TerminalSummary>();
  const unsubscribe = yield* terminals.subscribeMetadata((event) =>
    Effect.sync(() => {
      if (event.type === "snapshot") {
        liveTerminals.clear();
        for (const terminal of event.terminals)
          liveTerminals.set(`${terminal.threadId}\0${terminal.terminalId}`, terminal);
      } else if (event.type === "remove") {
        liveTerminals.delete(`${event.threadId}\0${event.terminalId}`);
      } else {
        liveTerminals.set(
          `${event.terminal.threadId}\0${event.terminal.terminalId}`,
          event.terminal,
        );
      }
    }),
  );
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

  const execute: WorkspaceCleanup["Service"]["execute"] = Effect.fn("WorkspaceCleanup.execute")(
    function* (effect, options) {
      const request = effect.request;
      if (request.type !== "workspace.cleanup") return;
      const project = yield* projects.get(request.projectId, { includeDeleted: true });
      if (Option.isNone(project)) return;
      const root = canonicalPath(project.value.workspaceRoot);
      const workspace = canonicalPath(request.worktreePath ?? project.value.workspaceRoot);
      if (workspace === null || root === null)
        return yield* new WorkspaceCleanupError({ effectId: effect.id, reason: "path" });
      if (root !== request.workspaceRoot || workspace !== request.canonicalWorkspacePath) return;
      yield* withWorkspaceLeases(
        [workspace],
        Effect.gen(function* () {
          // No command, root, alias, generation, or reference may be trusted from the claim.
          const currentProject = yield* projects.get(request.projectId, { includeDeleted: true });
          if (
            Option.isNone(currentProject) ||
            canonicalPath(currentProject.value.workspaceRoot) !== root
          )
            return;
          if (
            canonicalPath(request.worktreePath ?? currentProject.value.workspaceRoot) !== workspace
          )
            return;
          const current = yield* sql<{
            worktree_path: string | null;
            project_id: string;
            archived_at: string | null;
            deleted_at: string | null;
          }>`
          SELECT json_extract(payload_json, '$.worktreePath') AS worktree_path, project_id, archived_at, deleted_at
          FROM orchestration_v2_projection_threads WHERE thread_id = ${effect.threadId}
        `;
          const thread = current[0];
          if (
            thread === undefined ||
            thread.deleted_at !== null ||
            thread.archived_at !== request.archivedAt ||
            thread.project_id !== request.projectId ||
            thread.worktree_path !== request.worktreePath
          )
            return;
          const generation = yield* sql<{ command_id: string | null }>`
          SELECT command_id FROM orchestration_events
          WHERE aggregate_kind = 'thread' AND stream_id = ${effect.threadId}
            AND application_event_version = 2 AND event_type IN ('thread.archived', 'thread.unarchived')
          ORDER BY sequence DESC LIMIT 1
        `;
          if (generation[0]?.command_id !== effect.commandId) return;
          const owned = yield* sql`
          SELECT 1 FROM orchestration_v2_effect_outbox
          WHERE effect_id = ${effect.id} AND status = 'running' AND lease_owner = ${effect.leaseOwner}
        `;
          if (owned.length === 0) return;

          const references = yield* sql<{ cwd: string | null }>`
          SELECT COALESCE(json_extract(t.payload_json, '$.worktreePath'), p.workspace_root) AS cwd
          FROM orchestration_v2_projection_threads t
          LEFT JOIN projection_projects p ON p.project_id = t.project_id
          WHERE t.archived_at IS NULL AND t.deleted_at IS NULL
          UNION ALL
          SELECT json_extract(s.payload_json, '$.cwd') AS cwd
          FROM orchestration_v2_projection_checkpoint_scopes s
          JOIN orchestration_v2_projection_threads t ON t.thread_id = s.thread_id
          WHERE t.archived_at IS NULL AND t.deleted_at IS NULL
        `;
          const overlaps = (cwd: string | null) => {
            const canonical = cwd === null ? null : canonicalPath(cwd);
            // An unreadable live reference cannot prove exclusive ownership.
            return canonical === null || workspacesOverlap(workspace, canonical);
          };
          if (references.some((reference) => overlaps(reference.cwd))) return;

          // Concurrent sibling archives select the newest cleanup. Earlier effects
          // can finish without running a second copy of the repository command.
          const newer = yield* sql<{
            cwd: string | null;
            expected_cwd: string | null;
            root: string | null;
            expected_root: string | null;
          }>`
          SELECT COALESCE(json_extract(e.payload_json, '$.worktreePath'), p.workspace_root) AS cwd,
            json_extract(e.payload_json, '$.canonicalWorkspacePath') AS expected_cwd,
            p.workspace_root AS root, json_extract(e.payload_json, '$.workspaceRoot') AS expected_root
          FROM orchestration_v2_effect_outbox e
          JOIN orchestration_v2_projection_threads t ON t.thread_id = e.thread_id
          LEFT JOIN projection_projects p ON p.project_id = t.project_id
          WHERE e.effect_type = 'workspace.cleanup'
            AND e.rowid > (SELECT rowid FROM orchestration_v2_effect_outbox WHERE effect_id = ${effect.id})
            AND t.archived_at = json_extract(e.payload_json, '$.archivedAt')
            AND t.deleted_at IS NULL AND e.status != 'cancelled'
            AND t.project_id = json_extract(e.payload_json, '$.projectId')
            AND json_extract(t.payload_json, '$.worktreePath') IS json_extract(e.payload_json, '$.worktreePath')
            AND e.command_id = (
              SELECT command_id FROM orchestration_events
              WHERE aggregate_kind = 'thread' AND stream_id = e.thread_id AND application_event_version = 2
                AND event_type IN ('thread.archived', 'thread.unarchived')
              ORDER BY sequence DESC LIMIT 1
            )
        `;
          if (
            newer.some(
              (reference) =>
                reference.cwd !== null &&
                reference.root !== null &&
                reference.expected_cwd === workspace &&
                reference.expected_root === root &&
                canonicalPath(reference.cwd) === workspace &&
                canonicalPath(reference.root) === reference.expected_root,
            )
          )
            return;

          const sessions = yield* sql<{ cwd: string | null }>`
          SELECT json_extract(payload_json, '$.cwd') AS cwd
          FROM orchestration_v2_projection_provider_sessions WHERE status != 'stopped'
        `;
          if (
            sessions.some((session) => overlaps(session.cwd)) ||
            [...liveTerminals.values()].some(
              (terminal) =>
                (terminal.status === "starting" || terminal.status === "running") &&
                (overlaps(terminal.cwd) ||
                  (terminal.worktreePath !== null && overlaps(terminal.worktreePath))),
            )
          ) {
            return yield* new WorkspaceCleanupError({ effectId: effect.id, reason: "busy" });
          }
          const config = yield* loader.load(root);
          if (Option.isNone(config) || config.value.workspaceCleanupCommand === undefined) return;
          const windows = yield* HostProcess.isWindows;
          // Expand the path as one shell argument; never interpolate it into shell code.
          const command = `${config.value.workspaceCleanupCommand} --workspace-path ${windows ? '"%T3CODE_WORKTREE_PATH%"' : '"$T3CODE_WORKTREE_PATH"'}${options?.dryRun === true ? " --dry-run" : ""}`;
          const result = yield* processes.run({
            command: windows ? "cmd.exe" : "/bin/sh",
            args: windows ? ["/d", "/s", "/c", command] : ["-c", command],
            cwd: root,
            env: projectScriptRuntimeEnv({ project: { cwd: root }, worktreePath: workspace }),
            timeout: "10 minutes",
            timeoutBehavior: "timedOutResult",
            maxOutputBytes: 256 * 1024,
            outputMode: "truncate",
          });
          if (result.timedOut || result.code !== 0)
            return yield* new WorkspaceCleanupError({
              effectId: effect.id,
              reason: result.timedOut ? "timeout" : "command",
              ...(result.code === null ? {} : { exitCode: result.code }),
              cause: { stdout: result.stdout, stderr: result.stderr },
            });
        }),
        "exclusive",
        [root],
      );
    },
    (operation, effect) =>
      operation.pipe(
        Effect.mapError((cause) =>
          isWorkspaceCleanupError(cause)
            ? cause
            : new WorkspaceCleanupError({ effectId: effect.id, reason: "state", cause }),
        ),
      ),
  );
  return WorkspaceCleanup.of({ execute });
});

export const layer = Layer.effect(WorkspaceCleanup, make);
