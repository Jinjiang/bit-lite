import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export type ViteServerHandle = {
  url: string;
  close(): Promise<void>;
};

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(packageRoot, "fixtures/vite");

export async function startViteDevServer(): Promise<ViteServerHandle> {
  const port = await findOpenPort(readPreferredPort());

  console.log("Starting Vite Dev Server through createServer()...");
  const server = await createServer({
    root: fixtureRoot,
    configFile: false,
    clearScreen: true,
    logLevel: "info",
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      hmr: true,
    },
    plugins: [
      {
        name: "demo-vite-worker-console-plugin",
        configureServer() {
          console.log("[vite plugin] configureServer wrote to stdout");
        },
        buildStart() {
          console.log("[vite plugin] buildStart wrote to stdout");
        },
        handleHotUpdate(context) {
          console.log(`[vite plugin] hot update: ${path.relative(fixtureRoot, context.file)}`);
        },
      },
    ],
  });

  await server.listen();
  server.printUrls();

  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    async close() {
      console.log("Stopping Vite Dev Server...");
      await server.close();
    },
  };
}

function readPreferredPort() {
  const port = Number.parseInt(process.env.DEMO_VITE_PORT ?? "", 10);
  return Number.isInteger(port) ? port : 4402;
}

async function findOpenPort(preferredPort: number) {
  if (await canListen(preferredPort)) return preferredPort;
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) {
          resolve(address.port);
        } else {
          reject(new Error("Unable to allocate an open port."));
        }
      });
    });
  });
}

function canListen(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}
