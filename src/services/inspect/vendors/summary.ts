import { createServiceTask } from "../../../runtime.js";
import type { InspectVendor } from "../../../types/services/inspect.js";

export const summaryInspectVendor: InspectVendor = {
  name: "summary",
  run(input, context) {
    return createServiceTask(async () => {
      const componentIds = input.components.map((component) => component.id).sort();
      return {
        ok: true,
        message: [
          `inspect summary for ${context?.envName ?? "unknown"}`,
          `components: ${componentIds.length}`,
          ...componentIds.map((id) => `- ${id}`),
        ].join("\n"),
      };
    });
  },
};

export default summaryInspectVendor;
