import { componentsCommand } from "./components.js";
import { envsCommand } from "./envs.js";
import { previewCommand } from "./preview.js";
import { createServiceCommand } from "./service.js";
import { startCommand } from "./start.js";
import { testCommand } from "./test.js";
import type { BitLiteCommand } from "./types.js";

export const commands: Record<string, BitLiteCommand> = {
  components: componentsCommand,
  envs: envsCommand,
  inspect: createServiceCommand("inspect"),
  preview: previewCommand,
  start: startCommand,
  test: testCommand,
  typecheck: createServiceCommand("typecheck"),
  typescript: createServiceCommand("typescript"),
};
