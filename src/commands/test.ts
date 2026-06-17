import { createTestRunReporter } from "../reporter/test-reporter.js";
import { runServiceGroupsCommand } from "./helpers.js";
import type { BitLiteCommand } from "./types.js";

export const testCommand: BitLiteCommand = {
  name: "test",
  async run({ workspace, args }) {
    const reporter = createTestRunReporter(workspace, args.includes("--watch"));
    return runServiceGroupsCommand(workspace, "test", args, reporter);
  },
};
