const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { Worker } = require("node:worker_threads");

const packageRoot = path.resolve(__dirname, "..");
const defaultHost = "127.0.0.1";
const defaultPort = Number(process.env.DEMO_JEST_WATCH_API_PORT ?? 3000);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const terminalModule = await import(pathToFileUrl(path.join(packageRoot, "../bit-lite-terminal/dist/index.js")));
  const { ManagedTerminal, RawOutputBuffer, bindTerminalResize, readTerminalSize } = terminalModule;
  const resultStore = createResultStore(["jest", "vitest"]);
  const server = await startResultServer(resultStore, defaultPort, defaultHost);
  const serverUrl = `http://${defaultHost}:${server.address().port}`;
  const workers = new Map();
  const items = [
    createItem(RawOutputBuffer, "jest", "Jest"),
    createItem(RawOutputBuffer, "vitest", "Vitest"),
  ];

  const terminal = new ManagedTerminal({
    title: () => `demo-jest-watch-api workers  ${serverUrl}`,
    instructions:
      "Use Up/Down + Enter for native worker output. Press q or Ctrl+C to stop. Results: /jest/results.json, /jest/results.txt, /vitest/results.json, /vitest/results.txt",
    items,
    onQuit: async () => {
      await stopWorkers(workers, terminal, items, server);
    },
  });

  for (const item of items) {
    const worker = startWorker(item.id, item);
    workers.set(item.id, worker);
  }

  terminal.start();
  terminal.renderNow();

  function startWorker(vendor, item) {
    const worker = new Worker(path.join(__dirname, `workers/${vendor}-watch-worker.cjs`), {
      stdin: true,
      stdout: true,
      stderr: true,
      workerData: {
        packageRoot,
        terminal: readTerminalSize(),
      },
    });
    const unbindTerminalResize = bindTerminalResize(worker);

    item.writeInput = (chunk) => {
      worker.stdin.write(chunk);
    };

    worker.stdout.on("data", (chunk) => terminal.appendOutput(item, "stdout", chunk));
    worker.stderr.on("data", (chunk) => terminal.appendOutput(item, "stderr", chunk));
    worker.on("message", (message) => handleWorkerMessage(message, item, terminal, resultStore));
    worker.on("error", (error) => {
      item.status = "error";
      item.details = [error.message];
      terminal.appendOutput(item, "stderr", `${error.stack ?? error.message}\n`);
      terminal.scheduleRender();
    });
    worker.on("exit", (code) => {
      unbindTerminalResize();
      item.status = code === 0 ? "stopped" : "exited";
      item.details = [`code ${code}`];
      terminal.scheduleRender();
    });

    return worker;
  }
}

function createItem(RawOutputBuffer, id, label) {
  return {
    id,
    label,
    status: "starting",
    hint: "waiting",
    details: [],
    rawOutput: new RawOutputBuffer(),
  };
}

function handleWorkerMessage(message, item, terminal, resultStore) {
  if (message?.type === "status") {
    item.status = message.status;
    terminal.scheduleRender();
    return;
  }

  if (message?.type === "error") {
    item.status = "error";
    item.details = [message.message.split("\n")[0]];
    terminal.appendOutput(item, "stderr", `${message.message}\n`);
    terminal.scheduleRender();
    return;
  }

  if (message?.type !== "result") return;

  resultStore.add(message.vendor, message.json, message.text);
  const failed = readFailedCount(message.json);
  item.status = failed > 0 ? "failed" : "passed";
  item.hint = `run ${message.run}`;
  item.details = [formatStats(message.json), "HTTP updated"];
  terminal.scheduleRender();
}

async function stopWorkers(workers, terminal, items, server) {
  for (const item of items) {
    item.status = "stopping";
    item.details = [];
  }
  terminal.scheduleRender();

  for (const worker of workers.values()) {
    worker.postMessage({ type: "shutdown" });
    worker.stdin.write("q");
  }

  await Promise.race([
    Promise.allSettled([...workers.values()].map((worker) => onceExit(worker))),
    delay(3000),
  ]);

  for (const worker of workers.values()) {
    worker.stdin.destroy();
    worker.stdout.destroy();
    worker.stderr.destroy();
    worker.unref();
    worker.terminate().catch(() => undefined);
  }

  terminal.stop({ clearScreen: true });
  server.close();
  exitProcess(0);
}

function onceExit(worker) {
  return new Promise((resolve) => worker.once("exit", resolve));
}

function readFailedCount(json) {
  return json.numFailedTests ?? json.stats?.failed ?? 0;
}

function formatStats(json) {
  if (json.vendor === "vitest") {
    return `${json.stats.passed}/${json.stats.total} passed`;
  }
  return `${json.numPassedTests}/${json.numTotalTests} passed`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pathToFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

function createResultStore(vendors) {
  const store = new Map(vendors.map((vendor) => [vendor, { json: [], text: [] }]));

  return {
    add(vendor, json, text) {
      const entry = store.get(vendor);
      if (!entry) return;

      const observedAt = new Date().toISOString();
      entry.json.push({ observedAt, ...json });
      entry.text.push([`# ${vendor} run ${json.run ?? entry.text.length + 1} @ ${observedAt}`, text].join("\n"));
    },
    json(vendor) {
      return store.get(vendor)?.json ?? [];
    },
    text(vendor) {
      return (store.get(vendor)?.text ?? []).join("\n---\n");
    },
    vendors() {
      return [...store.keys()];
    },
  };
}

function startResultServer(resultStore, port, host) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}`);
    const match = url.pathname.match(/^\/([^/]+)\/results\.(json|txt)$/);

    if (!match) {
      writeJson(response, 200, {
        endpoints: Object.fromEntries(
          resultStore.vendors().map((vendor) => [
            vendor,
            {
              json: `/${vendor}/results.json`,
              text: `/${vendor}/results.txt`,
            },
          ])
        ),
      });
      return;
    }

    const [, vendor, format] = match;
    if (!resultStore.vendors().includes(vendor)) {
      writeJson(response, 404, { error: `Unknown result component "${vendor}".` });
      return;
    }

    if (format === "json") {
      writeJson(response, 200, resultStore.json(vendor));
      return;
    }

    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(`${resultStore.text(vendor)}\n`);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function exitProcess(code) {
  process.exitCode = code;
  process.kill(process.pid, "SIGTERM");
}
