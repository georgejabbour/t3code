import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { FetchHttpClient } from "effect/http";

import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as ServerConfig from "./config.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as McpSessionRegistry from "./mcp/McpSessionRegistry.ts";
import * as ThreadPullRequestService from "./orchestration-v2/ThreadPullRequestService.ts";
import * as SubscriptionUsageHistoryStore from "./provider/SubscriptionUsageHistoryStore.ts";
import * as ResourceAttribution from "./resourceTelemetry/ResourceAttribution.ts";
import * as Server from "./server.ts";
import * as VcsProcess from "./vcs/VcsProcess.ts";

it.effect(
  "retains subscription history and WebSocket services in the production dependency graph",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const scratch = path.join(process.cwd(), ".scratch");
      yield* fs.makeDirectory(scratch, { recursive: true });
      const home = yield* fs.makeTempDirectoryScoped({ directory: scratch, prefix: "startup-" });
      const config = yield* ServerConfig.ServerConfig.pipe(
        Effect.provide(ServerConfig.layerTest(home, home)),
      );
      const context = yield* Layer.build(
        Server.layerRuntimeDependencies.pipe(
          Layer.provide(
            McpSessionRegistry.layer.pipe(
              Layer.provide(ServerEnvironment.layer),
              Layer.provide(ServerSecretStore.layer),
              Layer.provide(NodeHttpServer.layerTest),
            ),
          ),
          Layer.provide(ResourceAttribution.layer),
          Layer.provide(VcsProcess.layer),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(ServerConfig.layer(config)),
        ),
      );
      assert.deepEqual(
        yield* Context.get(context, SubscriptionUsageHistoryStore.SubscriptionUsageHistoryStore)
          .read,
        { peaks: [] },
      );
      // WebSocket handlers resolve this service after startup has completed.
      const threadPullRequests = yield* ThreadPullRequestService.ThreadPullRequestServiceV2.pipe(
        Effect.provide(context),
      );
      yield* threadPullRequests.drain;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
