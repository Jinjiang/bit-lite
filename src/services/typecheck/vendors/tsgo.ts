import { createRequire } from "node:module";
import path from "node:path";
import { runNodeScript } from "../../../utils/process.js";
import { readObjectConfig, rejectCliArgs } from "../../../service-config.js";
import { createServiceTask } from "../../../runtime.js";
import { serviceResult } from "../../../utils/service-result.js";
import type { TypecheckVendor } from "../../../types/services/typecheck.js";

const require = createRequire(import.meta.url);

export const tsgoTypecheckVendor: TypecheckVendor = {
  name: "tsgo",
  run(input, context) {
    return createServiceTask(async ({ signal, emit }) => {
      const workspaceRoot = requireWorkspaceRoot(context);
      rejectCliArgs(input.args, "typecheck");
      const config = readObjectConfig(input.config);
      const tsconfig = typeof config.tsconfig === "string" ? config.tsconfig : "tsconfig.json";
      const tsgoPath = path.join(path.dirname(require.resolve("@typescript/native-preview/package.json")), "bin/tsgo.js");
      const exitCode = await runNodeScript(tsgoPath, {
        cwd: workspaceRoot,
        args: ["-p", path.resolve(workspaceRoot, tsconfig)],
        onOutput: (stream, chunk) => emit("output", { stream, chunk }),
        signal,
      });
      const text = exitCode === 0 ? `tsgo typecheck passed for ${context?.envName}` : `tsgo typecheck failed for ${context?.envName}`;
      return {
        ...serviceResult({
          ok: exitCode === 0,
          toJSON: () => ({
            checker: "tsgo",
            runner: "process" as const,
            envName: context?.envName,
            diagnostics: [],
          }),
          toString: () => text,
        }),
      };
    });
  },
};

export default tsgoTypecheckVendor;

function requireWorkspaceRoot(context: { workspaceRoot?: string } | undefined) {
  if (!context?.workspaceRoot) throw new Error("typecheck requires workspaceRoot in context");
  return context.workspaceRoot;
}
