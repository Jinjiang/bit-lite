import { createServiceTask } from "../../../runtime.js";
import { serviceResult } from "../../../utils/service-result.js";
import type { InspectVendor } from "../../../types/services/inspect.js";

export const defaultInspectVendor: InspectVendor = {
  name: "default",
  run(input, context) {
    return createServiceTask(async () => {
      const toJSON = () => ({
        workspaceRoot: context?.workspaceRoot,
        envName: context?.envName,
        serviceConfig: input.config,
        components: input.components,
      });
      return serviceResult({
        ok: true,
        toJSON,
        toString: () => JSON.stringify(toJSON(), null, 2),
      });
    });
  },
};

export default defaultInspectVendor;
