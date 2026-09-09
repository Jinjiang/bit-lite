import type { WorkspaceEnvGroup } from "bit-lite-env-resolution";

/**
 * What a command says when the selection produced no vendor work.
 *
 * Which of the two reasons applies decides what the user should do next —
 * nothing was selected, or nothing selected configures this service — and
 * `test` and `preview` answer that identically. Naming the service is the only
 * difference between them.
 */
export function printNoTasks(
  serviceName: "test" | "preview",
  groups: readonly WorkspaceEnvGroup[],
  log: (message: string) => void = console.log
): void {
  log(`No ${serviceName} tasks found.`);
  if (groups.length === 0) {
    log("No components were selected from this workspace.");
    return;
  }
  log(`Selected envs: ${groups.map((group) => group.env.identity.packageName).join(", ")}`);
  log(`Make sure each selected env defines services.${serviceName} in the workspace config.`);
}
