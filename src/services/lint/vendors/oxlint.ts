import { createRequire } from "node:module";
import path from "node:path";
import { createServiceTask } from "../../../runtime.js";
import { runNodeScript } from "../../../utils/process.js";
import type { LintVendor } from "../../../types/services/lint.js";
import { createLintResult, createLintTargets, readLintVendorConfig, requireWorkspaceRoot } from "../runtime.js";

const require = createRequire(import.meta.url);

export const oxlintLintVendor: LintVendor = {
  name: "oxlint",
  run(input, context) {
    return createServiceTask(async ({ signal, emit }) => {
      const workspaceRoot = requireWorkspaceRoot(context);
      const config = readLintVendorConfig(input.config);
      const targets = createLintTargets(workspaceRoot, input.components);
      const oxlintPath = path.join(path.dirname(require.resolve("oxlint/package.json")), "bin/oxlint");
      const args = [
        ...(config.configFile ? ["--config", path.resolve(workspaceRoot, config.configFile)] : []),
        "--no-error-on-unmatched-pattern",
        ...(config.args ?? []),
        ...(input.args ?? []),
        ...targets,
      ];
      emit("status", {
        status: "running",
        message: `running oxlint for ${context?.envName}`,
      });
      const exitCode = await runNodeScript(oxlintPath, {
        cwd: workspaceRoot,
        args,
        onOutput: (stream, chunk) => emit("output", { stream, chunk }),
        signal,
      });
      const result = createLintResult({
        vendor: "oxlint",
        envName: context?.envName,
        targets,
        exitCode,
      });
      emit("status", { status: result.ok ? "passed" : "failed", message: result.toString() });
      emit("result", result);
      return result;
    });
  },
};

export default oxlintLintVendor;
