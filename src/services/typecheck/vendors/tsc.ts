import { createRequire } from "node:module";
import path from "node:path";
import { runNodeScript } from "../../../utils/process.js";
import { readObjectConfig, rejectCliArgs } from "../../../service-config.js";
import { createServiceTask } from "../../../runtime.js";
import { serviceResult } from "../../../utils/service-result.js";
import type { TypecheckVendor } from "../../../types/services/typecheck.js";

const require = createRequire(import.meta.url);

export const tscTypecheckVendor: TypecheckVendor = {
  name: "tsc",
  run(input, context) {
    return createServiceTask(async ({ signal, emit }) => {
      const workspaceRoot = requireWorkspaceRoot(context);
      rejectCliArgs(input.args, "typecheck");
      const config = readObjectConfig(input.config);
      const tsconfig = typeof config.tsconfig === "string" ? config.tsconfig : "tsconfig.json";
      const tscPath = require.resolve("typescript/bin/tsc");
      const exitCode = await runNodeScript(tscPath, {
        cwd: workspaceRoot,
        args: ["-p", path.resolve(workspaceRoot, tsconfig)],
        onOutput: (stream, chunk) => emit("output", { stream, chunk }),
        signal,
      });
      const text = exitCode === 0 ? `typecheck passed for ${context?.envName}` : `typecheck failed for ${context?.envName}`;
      return {
        ...serviceResult({
          ok: exitCode === 0,
          toJSON: () => ({
            checker: "typescript",
            runner: "process" as const,
            envName: context?.envName,
            errors: exitCode === 0 ? 0 : 1,
            warnings: 0,
            diagnostics: [],
          }),
          toString: () => text,
        }),
      };
    });
  },
};

export default tscTypecheckVendor;

function requireWorkspaceRoot(context: { workspaceRoot?: string } | undefined) {
  if (!context?.workspaceRoot) throw new Error("typecheck requires workspaceRoot in context");
  return context.workspaceRoot;
}
