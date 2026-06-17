import type { BitLiteCommand } from "./types.js";
import { runServiceGroupsCommand } from "./helpers.js";

export function createServiceCommand(serviceName: string): BitLiteCommand {
  return {
    name: serviceName,
    async run({ workspace, args }) {
      return runServiceGroupsCommand(workspace, serviceName, args);
    },
  };
}
