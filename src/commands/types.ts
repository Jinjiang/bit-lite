import type { WorkspaceRuntime } from "../types/index.js";

export type CommandContext = {
  workspace: WorkspaceRuntime;
  args: string[];
};

export type BitLiteCommand = {
  name: string;
  run(context: CommandContext): Promise<number>;
};
