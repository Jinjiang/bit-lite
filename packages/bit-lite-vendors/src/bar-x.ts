import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { CliArguments } from "bit-lite-context";
import type {
  ServiceVendor,
  ServiceVendorCallPayload,
  ServiceVendorEventListener,
  ServiceVendorEventPayload,
  ServiceVendorEventType,
  ServiceVendorInput,
  ServiceVendorResult,
} from "./types/index.js";

const DEFAULT_PORT = 3000;
const STARTUP_DELAY_MS = 5000;

export type BarXResult = {
  service: "bar";
  vendor: "x";
  requestedPort: number;
  port: number;
  url: string;
  componentCount: number;
  args: CliArguments;
  note: string;
};

export const barXVendor: ServiceVendor<Record<string, unknown>, CliArguments, BarXResult> = {
  name: "x",
  run(input) {
    const requestedPort = readRequestedPort(input);
    const listeners = new Set<ServiceVendorEventListener>();
    let resolveResult: (result: ServiceVendorResult<BarXResult>) => void;
    let resultSettled = false;
    let server: Server | undefined;
    let stopping = false;
    const result = new Promise<ServiceVendorResult<BarXResult>>((resolve) => {
      resolveResult = resolve;
    });

    const emit = (type: ServiceVendorEventType, payload: ServiceVendorEventPayload) => {
      for (const listener of listeners) listener(type, payload);
    };

    const finish = (status: string, data: BarXResult) => {
      if (resultSettled) return;
      resultSettled = true;
      emit("status", { status });
      emit("result", { status, data });
      resolveResult({
        status,
        toJSON: () => data,
        toString: () => `bar/x:${status}:${data.url || `port:${data.port}`}`,
      });
    };

    queueMicrotask(() => {
      void startServer(input, requestedPort, emit)
        .then((started) => {
          if (stopping) {
            started.server.close();
            finish("stopped", createResult(input, requestedPort, 0, "server was stopped before it became ready"));
            return;
          }

          server = started.server;
          finish("ready", createResult(input, requestedPort, started.port, "server is listening"));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          emit("log", { level: "error", message, scope: "bar" });
          finish("error", createResult(input, requestedPort, 0, message));
        });
    });

    return {
      result,
      listen(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      abort() {
        stopping = true;
        stopServer(server, emit, "aborted");
        finish("stopped", createResult(input, requestedPort, 0, "server was aborted"));
      },
      call(type: string, payload?: ServiceVendorCallPayload) {
        emit("log", { level: "debug", message: `call:${type}:${readCallPayload(payload)}`, scope: "bar" });
        if (type === "stop") {
          stopping = true;
          stopServer(server, emit, payload?.reason ?? "stop call");
          finish("stopped", createResult(input, requestedPort, 0, payload?.reason ?? "server was stopped"));
        }
      },
    };
  },
};

async function startServer(
  input: ServiceVendorInput<Record<string, unknown>, CliArguments>,
  requestedPort: number,
  emit: (type: ServiceVendorEventType, payload: ServiceVendorEventPayload) => void
) {
  emit("status", { status: "creating", message: `creating server from port ${requestedPort}` });
  emit("progress", { total: 2, current: 1, label: "bar x server" });
  await wait(STARTUP_DELAY_MS);
  emit("progress", { total: 2, current: 2, label: "bar x server" });
  return listenOnAvailablePort(input, requestedPort, emit);
}

async function listenOnAvailablePort(
  input: ServiceVendorInput<Record<string, unknown>, CliArguments>,
  requestedPort: number,
  emit: (type: ServiceVendorEventType, payload: ServiceVendorEventPayload) => void
) {
  for (let port = requestedPort; port <= 65535; port += 1) {
    const server = createBarXServer(input, emit);
    const result = await tryListen(server, port);
    if (result.ok) {
      const address = server.address() as AddressInfo;
      emit("log", { level: "info", message: `bar/x listening on ${address.port}`, scope: "bar" });
      return { server, port: address.port };
    }

    if (result.code !== "EADDRINUSE") throw result.error;
    emit("log", { level: "warn", message: `port ${port} is busy, trying ${port + 1}`, scope: "bar" });
  }

  throw new Error(`No available port found from ${requestedPort}`);
}

function createBarXServer(
  input: ServiceVendorInput<Record<string, unknown>, CliArguments>,
  emit: (type: ServiceVendorEventType, payload: ServiceVendorEventPayload) => void
) {
  return createServer((request, response) => {
    const startedAt = Date.now();
    const method = request.method ?? "GET";
    const url = request.url ?? "/";

    response.once("finish", () => {
      emit("log", {
        level: "info",
        message: `${method} ${url} ${response.statusCode}`,
        scope: "bar",
        data: {
          method,
          url,
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
        },
      });
    });

    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("connection", "close");
    response.end(
      JSON.stringify({
        service: "bar",
        vendor: "x",
        ok: true,
        path: url,
        componentCount: input.components.length,
      })
    );
  });
}

function tryListen(server: Server, port: number) {
  return new Promise<{ ok: true } | { ok: false; code: string | undefined; error: Error }>((resolve) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      resolve({ ok: false, code: error.code, error });
    };
    const onListening = () => {
      server.off("error", onError);
      resolve({ ok: true });
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function stopServer(
  server: Server | undefined,
  emit: (type: ServiceVendorEventType, payload: ServiceVendorEventPayload) => void,
  reason: string
) {
  if (!server) {
    emit("status", { status: "stopping", message: reason });
    return;
  }

  server.close((error) => {
    if (error) {
      emit("log", { level: "error", message: error.message, scope: "bar" });
      return;
    }
    emit("status", { status: "stopped", message: reason });
  });
  server.closeIdleConnections();
  server.closeAllConnections();
}

function createResult(
  input: ServiceVendorInput<Record<string, unknown>, CliArguments>,
  requestedPort: number,
  port: number,
  note: string
): BarXResult {
  return {
    service: "bar",
    vendor: "x",
    requestedPort,
    port,
    url: port > 0 ? `http://127.0.0.1:${port}` : "",
    componentCount: input.components.length,
    args: input.args,
    note,
  };
}

function readRequestedPort(input: ServiceVendorInput<Record<string, unknown>, CliArguments>) {
  return readPortFromArgs(input.args) ?? readPort(input.config.port) ?? DEFAULT_PORT;
}

function readPortFromArgs(args: CliArguments) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--port" || arg === "-p" || arg === "port") {
      return readPort(args[index + 1]);
    }
    if (arg.startsWith("--port=")) return readPort(arg.slice("--port=".length));
    if (arg.startsWith("-p=")) return readPort(arg.slice("-p=".length));
    if (arg.startsWith("port=")) return readPort(arg.slice("port=".length));
  }

  return undefined;
}

function readPort(value: unknown) {
  const port = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

function readCallPayload(payload: ServiceVendorCallPayload | undefined) {
  if (!payload) return "";
  if (typeof payload.chunk === "string") return payload.chunk;
  if (payload.chunk instanceof Uint8Array) return new TextDecoder().decode(payload.chunk);
  if (payload.reason) return payload.reason;
  return payload.data === undefined ? "" : JSON.stringify(payload.data);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
