import type { EnvironmentId } from "@t3tools/contracts";
import { Text } from "react-native";

import { useGitStackPosition } from "../state/gitStacks";

// Added by this fork. The "n/N" chain read-out beside a thread's PR pill; see
// Patch 16 in PATCHES.md.

/**
 * "2/4" when the thread's branch sits in a GitHub stack — second branch of a
 * four-branch chain. Renders nothing otherwise, so a repository without stacks
 * looks exactly as it did.
 */
export function GitStackPositionMarker({
  environmentId,
  cwd,
  branchName,
  className,
  style,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly branchName: string | null | undefined;
  readonly className?: string;
  readonly style?: { readonly fontFamily?: string };
}) {
  const position = useGitStackPosition({ environmentId, cwd, branchName });
  if (position === null) {
    return null;
  }
  return (
    <Text
      className={className ?? "text-foreground-muted text-[10px] font-t3-medium tabular-nums"}
      style={style}
      accessibilityLabel={`Branch ${position.position} of ${position.length} in this stack`}
    >
      {position.text}
    </Text>
  );
}
