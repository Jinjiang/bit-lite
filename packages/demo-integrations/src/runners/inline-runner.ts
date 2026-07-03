// Inline runner: starts a vendor by importing its JavaScript module directly in
// the parent process. Tool stdout/stderr are not intercepted in this mode, so
// console output goes straight to the terminal.

import type {
  ManagerMessage,
  ManagerMessageListener,
  OutputListener,
  RunnerExitCode,
  VendorConfig,
  VendorDefinition,
  VendorHandle,
  VendorMessageListener,
  VendorRunner,
  VendorRuntime,
  VendorData,
  VendorModule,
} from "../types.js";

export function createInlineRunner<Config extends VendorConfig>(
  vendor: VendorDefinition<Config>,
  vendorData: VendorData<Config>
): VendorRunner {
  const parentMessageListeners = new Set<VendorMessageListener>();
  const vendorMessageListeners = new Set<ManagerMessageListener>();
  let vendorHandle: VendorHandle | void;
  let stopped = false;
  let resolveExit!: (code: RunnerExitCode) => void;

  const exitPromise = new Promise<RunnerExitCode>((resolve) => {
    resolveExit = resolve;
  });

  // Runtime object passed to the vendor implementation. It mirrors the worker
  // runtime shape so vendors can be written without knowing where they run.
  // Clone values at the runtime boundary to preserve Worker-style message
  // semantics even when the vendor runs in the same JavaScript realm.
  const runtime: VendorRuntime<Config> = {
    data: structuredClone(vendorData),
    postMessage(message) {
      const clonedMessage = structuredClone(message);
      for (const listener of parentMessageListeners) listener(clonedMessage);
    },
    onMessage(listener) {
      vendorMessageListeners.add(listener);
      return () => vendorMessageListeners.delete(listener);
    },
  };

  return {
    kind: "inline",
    exitPromise,
    onMessage(listener) {
      parentMessageListeners.add(listener);
      return () => parentMessageListeners.delete(listener);
    },
    onOutput(_listener: OutputListener) {
      // Inline mode deliberately does not proxy stdout/stderr. The vendor runs
      // in the parent process, so its terminal output is already visible.
      return () => {};
    },
    send(message: ManagerMessage) {
      const clonedMessage = structuredClone(message);
      for (const listener of vendorMessageListeners) listener(clonedMessage);
    },
    writeInput(_chunk) {},
    async start() {
      try {
        const vendorModule = (await import(vendor.vendorModuleUrl.href)) as VendorModule<Config>;
        const startVendor = vendorModule.default;

        if (typeof startVendor !== "function") {
          throw new Error("Vendor module must default export a StartVendor function.");
        }

        vendorHandle = await startVendor(runtime);
      } catch (error) {
        runtime.postMessage({ type: "error", message: formatError(error) });
        console.error(error);
        resolveExit(1);
      }
    },
    async stop() {
      if (stopped) return;
      stopped = true;

      this.send({ type: "shutdown" });
      await vendorHandle?.stop?.();
      resolveExit(0);
    },
    async terminate() {
      await this.stop();
    },
  };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
