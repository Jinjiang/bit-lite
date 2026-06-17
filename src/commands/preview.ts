import { createPreviewHost } from "../host/server.js";
import { createPreviewRunReporter } from "../reporter/preview-reporter.js";
import { resolveRunnableGroups, runRunnableGroup } from "../runtime.js";
import { closePreviewVendorServers } from "../services/preview/runtime.js";
import type { PreviewResult } from "../types/services/preview.js";
import { installRunControls, printServiceResults, waitForAbort } from "./helpers.js";
import type { BitLiteCommand } from "./types.js";

const FIRST_ENV_PORT = 3301;

export const previewCommand: BitLiteCommand = {
  name: "preview",
  async run({ workspace, args }) {
    if (args.length > 0) {
      throw new Error(`preview does not accept arguments: ${args.join(" ")}`);
    }

    const controller = new AbortController();
    const reporter = createPreviewRunReporter(workspace);
    const cleanupControls = installRunControls(controller, (chunk) => reporter.onInput?.(chunk));
    const host = await createPreviewHost({ title: "bit-lite preview" });
    try {
      const runnableGroups = await resolveRunnableGroups(workspace, "preview");
      const results = await Promise.all(
        runnableGroups.map(async (runnableGroup, index) => {
          const envName = runnableGroup.group.envName;
          const result = await runRunnableGroup(runnableGroup, {
            workspaceRoot: workspace.workspaceRoot,
            args: {
              port: FIRST_ENV_PORT + index,
              base: `/env/${encodeURIComponent(envName)}/`,
            },
            signal: controller.signal,
            onEvent: reporter.onEvent,
            ...(reporter.onTask ? { onTask: reporter.onTask } : {}),
          });
          host.registerPreview(result.envName, result.result as PreviewResult);
          return result;
        })
      );

      reporter.flush();
      printServiceResults("preview", results);
      if (results.every(({ result }) => result.ok)) {
        console.log(`preview UI running at ${host.url}`);
        await waitForAbort(controller.signal);
      }
      return results.every(({ result }) => result.ok) ? 0 : 1;
    } finally {
      cleanupControls();
      reporter.close?.();
      await host.stop();
      await closePreviewVendorServers();
    }
  },
};
