export function createDemoVendor(name) {
  return {
    name,
    run(input, context) {
      const listeners = new Set();
      let settled = false;
      let aborted = false;
      let resolveResult;
      const delay = readDelay(input.config);

      const emit = (type, payload) => {
        for (const listener of listeners) {
          listener(type, payload);
        }
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        const status = aborted ? "aborted" : "ok";
        resolveResult({
          status,
          toJSON() {
            return {
              vendor: name,
              status,
              componentIds: input.components.map((component) => component.id),
              args: input.args,
              config: input.config,
              workspaceRoot: context?.workspaceRoot,
            };
          },
          toString() {
            return `${name}:${status}:${input.components.map((component) => component.id).join(",")}`;
          },
        });
      };

      const result = new Promise((resolve) => {
        resolveResult = resolve;
        setTimeout(() => {
          if (settled) return;
          emit("ready", { vendor: name });
          emit("output", {
            stream: "stdout",
            chunk: `${name} received ${input.components.length} component(s)\n`,
          });
          finish();
        }, delay);
      });

      return {
        result,
        listen(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        abort() {
          aborted = true;
          emit("abort", { vendor: name });
          finish();
        },
        call(type, payload) {
          emit("call", { type, payload });
        },
      };
    },
  };
}

function readDelay(config) {
  if (typeof config !== "object" || config === null) return 0;
  const delay = config.delay;
  return typeof delay === "number" && Number.isFinite(delay) ? delay : 0;
}
