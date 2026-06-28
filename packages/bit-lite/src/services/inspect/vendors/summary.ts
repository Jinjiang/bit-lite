import { createServiceTask } from "../../../runtime.js";
import { serviceResult } from "../../../utils/service-result.js";
import type { InspectVendor } from "../../../types/services/inspect.js";

export const summaryInspectVendor: InspectVendor = {
  name: "summary",
  run(input, context) {
    return createServiceTask(async () => {
      const componentIds = input.components.map((component) => component.id).sort();
      const text = [
        `inspect summary for ${context?.envName ?? "unknown"}`,
        `components: ${componentIds.length}`,
        ...componentIds.map((id) => `- ${id}`),
      ].join("\n");
      return serviceResult({
        ok: true,
        toJSON: () => ({
          envName: context?.envName,
          components: componentIds,
        }),
        toString: () => text,
      });
    });
  },
};

export default summaryInspectVendor;
