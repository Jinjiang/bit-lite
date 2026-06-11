import { createServiceTask } from "../../../runtime.js";
import type { InspectVendor } from "../types.js";

export const defaultInspectVendor: InspectVendor = {
  name: "default",
  run(input, context) {
    return createServiceTask(async () => ({
      ok: true,
      message: JSON.stringify(
        {
          workspaceRoot: context?.workspaceRoot,
          envName: context?.envName,
          serviceConfig: input.config,
          components: input.components,
        },
        null,
        2
      ),
    }));
  },
};

export default defaultInspectVendor;
