import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

/**
 * Workspace file access requested through the ACP client `fs` capability.
 * The agent gates each write behind `session/request_permission`, so only
 * path containment is checked here.
 */
const CLIENT_FILE_MAX_BYTES = 8 * 1024 * 1024;

function isInsideRoot(path: Path.Path, root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolves an agent-supplied path and rejects anything outside the session
 * roots. Symlinks resolve before the check, including the final component, so
 * a link inside the workspace cannot read or write through to a file outside
 * it. An entry that exists but cannot be resolved, like a dangling link, is
 * rejected rather than written through.
 */
const resolveClientFilePath = Effect.fn("AntigravityClientFiles.resolveClientFilePath")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly requestPath: string;
  }) {
    const { path } = input;
    const resolved = path.resolve(input.requestPath);
    const outside = EffectAcpErrors.AcpRequestError.invalidParams(
      `Path '${input.requestPath}' is outside the session workspace.`,
    );
    let ancestor = resolved;
    const missingParts: string[] = [];
    let real: string;
    while (true) {
      const existing = yield* input.fileSystem.realPath(ancestor).pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : Effect.fail(
                EffectAcpErrors.AcpRequestError.invalidParams(
                  `Could not resolve path '${input.requestPath}'.`,
                ),
              ),
        ),
      );
      if (Option.isSome(existing)) {
        real = path.join(existing.value, ...missingParts);
        break;
      }
      const link = yield* input.fileSystem.readLink(ancestor).pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : Effect.fail(
                EffectAcpErrors.AcpRequestError.invalidParams(
                  `Could not resolve path '${input.requestPath}'.`,
                ),
              ),
        ),
      );
      if (Option.isSome(link)) {
        return yield* EffectAcpErrors.AcpRequestError.invalidParams(
          `Path '${input.requestPath}' contains a symbolic link with an absent target.`,
        );
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        return yield* EffectAcpErrors.AcpRequestError.invalidParams(
          `Could not resolve path '${input.requestPath}'.`,
        );
      }
      missingParts.unshift(path.basename(ancestor));
      ancestor = parent;
    }
    const roots = yield* Effect.forEach(input.allowedRoots, (root) =>
      input.fileSystem.realPath(root).pipe(Effect.orElseSucceed(() => root)),
    );
    if (!roots.some((root) => isInsideRoot(path, root, real))) {
      return yield* outside;
    }
    return real;
  },
);

export const readAntigravityClientTextFile = Effect.fn("AntigravityClientFiles.readTextFile")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly request: EffectAcpSchema.ReadTextFileRequest;
  }): Effect.fn.Return<EffectAcpSchema.ReadTextFileResponse, EffectAcpErrors.AcpError> {
    const filePath = yield* resolveClientFilePath({ ...input, requestPath: input.request.path });
    const info = yield* input.fileSystem
      .stat(filePath)
      .pipe(
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.resourceNotFound(
            `File '${input.request.path}' not found.`,
          ),
        ),
      );
    if (info.type !== "File" || Number(info.size) > CLIENT_FILE_MAX_BYTES) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `File '${input.request.path}' is not a readable text file under ${CLIENT_FILE_MAX_BYTES} bytes.`,
      );
    }
    const text = yield* input.fileSystem
      .readFileString(filePath)
      .pipe(
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.internalError(`Could not read '${input.request.path}'.`),
        ),
      );
    const line = input.request.line ?? undefined;
    const limit = input.request.limit ?? undefined;
    if (line === undefined && limit === undefined) {
      return { content: text };
    }
    // ACP lines are 1-indexed. `limit` is a line count.
    const lines = text.split("\n");
    const start = Math.max(0, (line ?? 1) - 1);
    const end = limit === undefined ? lines.length : Math.min(lines.length, start + limit);
    return { content: lines.slice(start, end).join("\n") };
  },
);

export const writeAntigravityClientTextFile = Effect.fn("AntigravityClientFiles.writeTextFile")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly request: EffectAcpSchema.WriteTextFileRequest;
  }): Effect.fn.Return<EffectAcpSchema.WriteTextFileResponse, EffectAcpErrors.AcpError> {
    const filePath = yield* resolveClientFilePath({ ...input, requestPath: input.request.path });
    yield* input.fileSystem.makeDirectory(input.path.dirname(filePath), { recursive: true }).pipe(
      Effect.andThen(input.fileSystem.writeFileString(filePath, input.request.content)),
      Effect.mapError(() =>
        EffectAcpErrors.AcpRequestError.internalError(`Could not write '${input.request.path}'.`),
      ),
    );
    return {};
  },
);
