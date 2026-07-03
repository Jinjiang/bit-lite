import { startViteDevServer } from "./start-vite-dev-server.js";

const handle = await startViteDevServer();
let shuttingDown = false;

process.on("SIGINT", () => {
  shutdown(0);
});

process.on("SIGTERM", () => {
  shutdown(0);
});

async function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;

  await handle.close();
  process.exit(code);
}
