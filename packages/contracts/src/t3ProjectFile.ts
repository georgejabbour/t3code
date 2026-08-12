import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ThreadEnvMode } from "./environment.ts";
import { ProjectScriptIcon } from "./orchestration.ts";

/** File name of the checked-in T3 project file, resolved at the workspace root. */
export const T3_PROJECT_FILE_NAME = "t3.json";

/** Public URL of the published JSON Schema for {@link T3ProjectFile}. */
export const T3_PROJECT_FILE_SCHEMA_URL = "https://t3.codes/schema/t3.json";

const T3_PROJECT_FILE_PATH_MAX_LENGTH = 512;
const T3_PROJECT_FILE_MAX_SCRIPTS = 50;
const T3_PROJECT_FILE_BRANCH_PREFIX_MAX_LENGTH = 64;

/**
 * Slash-separated segments, each starting with a letter or digit and holding
 * only letters, digits, `_` and `-`. This accepts `george` and `team/george`,
 * and rejects the shapes git refuses in a ref name: a leading or trailing
 * slash, an empty segment, `..`, and whitespace.
 */
const T3_PROJECT_FILE_BRANCH_PREFIX_PATTERN = /^[A-Za-z0-9][\w-]*(?:\/[A-Za-z0-9][\w-]*)*$/;

// Annotations go on the encoded (string) side so they survive into the
// published JSON Schema; decoding still trims and re-validates non-emptiness.
const trimmedNonEmpty = (
  annotations: { readonly description: string },
  maxLength?: number,
  pattern?: RegExp,
) => {
  let encoded = Schema.String.annotate(annotations).check(Schema.isNonEmpty());
  if (maxLength !== undefined) {
    encoded = encoded.check(Schema.isMaxLength(maxLength));
  }
  if (pattern !== undefined) {
    encoded = encoded.check(Schema.isPattern(pattern));
  }
  return encoded.pipe(Schema.decodeTo(encoded, SchemaTransformation.trim()));
};

export const T3ProjectFileBranchPrefix = trimmedNonEmpty(
  {
    description:
      'First segment of the branch name T3 Code creates for a new thread, so a repository keeps its own branch convention. For example "george" makes T3 Code name a branch "george/fix-login". T3 Code lowercases the value. Defaults to "t3code".',
  },
  T3_PROJECT_FILE_BRANCH_PREFIX_MAX_LENGTH,
  T3_PROJECT_FILE_BRANCH_PREFIX_PATTERN,
);

export const T3ProjectFileScript = Schema.Struct({
  name: trimmedNonEmpty({
    description: "Display name for the script, shown in the T3 Code scripts menu.",
  }),
  command: trimmedNonEmpty({
    description: "Shell command executed in a T3 Code terminal at the project root.",
  }),
  icon: Schema.optionalKey(
    ProjectScriptIcon.annotate({
      description: 'Icon shown next to the script in the scripts menu. Defaults to "play".',
    }),
  ),
  runOnWorktreeCreate: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, the script runs automatically after a worktree is created for a new thread.",
    }),
  ),
  runOnWorktreeRemove: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, the script runs to completion before a worktree is removed, and a non-zero exit cancels the removal.",
    }),
  ),
  previewUrl: Schema.optionalKey(
    trimmedNonEmpty({
      description:
        "URL opened in the in-app browser preview when this script runs. Only honored on the desktop build.",
    }),
  ),
  autoOpenPreview: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, automatically open the preview panel at `previewUrl` the moment the script starts.",
    }),
  ),
}).annotate({
  description: "A project script that team members can import into T3 Code.",
});
export type T3ProjectFileScript = typeof T3ProjectFileScript.Type;

export const T3ProjectFile = Schema.Struct({
  $schema: Schema.optionalKey(
    Schema.String.annotate({
      description: `URL of the JSON Schema for this file, typically "${T3_PROJECT_FILE_SCHEMA_URL}".`,
    }),
  ),
  iconPath: Schema.optionalKey(
    trimmedNonEmpty(
      {
        description:
          'Workspace-relative path to the project icon (e.g. "assets/logo.svg"). Checked before T3 Code\'s built-in icon locations.',
      },
      T3_PROJECT_FILE_PATH_MAX_LENGTH,
    ),
  ),
  defaultThreadEnvMode: Schema.optionalKey(
    ThreadEnvMode.annotate({
      description:
        'Where new threads start for this repository: "worktree" for a fresh git worktree, "local" for the current checkout. A per-project setting in T3 Code overrides this; when neither is set, the global default applies.',
    }),
  ),
  branchPrefix: Schema.optionalKey(T3ProjectFileBranchPrefix),
  scripts: Schema.optionalKey(
    Schema.Array(T3ProjectFileScript)
      .annotate({
        description: "Project scripts shared with everyone who opens this repository in T3 Code.",
      })
      .check(Schema.isMaxLength(T3_PROJECT_FILE_MAX_SCRIPTS)),
  ),
}).annotate({
  title: "T3 project file",
  description:
    "Checked-in project configuration for T3 Code (t3.json at the repository root). See https://t3.codes for documentation.",
});
export type T3ProjectFile = typeof T3ProjectFile.Type;
