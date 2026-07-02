// Inline runner: starts a service by importing its JavaScript module directly in
// the parent process. Tool stdout/stderr are not intercepted in this mode, so
// console output goes straight to the terminal.

import type {
  ManagerMessage,
  ManagerMessageListener,
  OutputListener,
  RunnerExitCode,
  ServiceDefinition,
  ServiceHandle,
  ServiceMessageListener,
  ServiceRunner,
  ServiceRuntime,
  ServiceData,
  ServiceModule,
} from "../types.js";

export function createInlineRunner(service: ServiceDefinition, serviceData: ServiceData): ServiceRunner {
  const parentMessageListeners = new Set<ServiceMessageListener>();
  const serviceMessageListeners = new Set<ManagerMessageListener>();
  let serviceHandle: ServiceHandle | void;
  let stopped = false;
  let resolveExit!: (code: RunnerExitCode) => void;

  const exitPromise = new Promise<RunnerExitCode>((resolve) => {
    resolveExit = resolve;
  });

  // Runtime object passed to the service implementation. It mirrors the worker
  // runtime shape so services can be written without knowing where they run.
  const runtime: ServiceRuntime = {
    data: serviceData,
    postMessage(message) {
      for (const listener of parentMessageListeners) listener(message);
    },
    onMessage(listener) {
      serviceMessageListeners.add(listener);
      return () => serviceMessageListeners.delete(listener);
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
      // Inline mode deliberately does not proxy stdout/stderr. The service runs
      // in the parent process, so its terminal output is already visible.
      return () => {};
    },
    send(message: ManagerMessage) {
      for (const listener of serviceMessageListeners) listener(message);
    },
    async start() {
      try {
        const serviceModule = (await import(service.serviceModuleUrl.href)) as ServiceModule;
        const startService = serviceModule.default;

        if (typeof startService !== "function") {
          throw new Error("Service module must default export a StartService function.");
        }

        serviceHandle = await startService(runtime);
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
      await serviceHandle?.stop?.();
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
