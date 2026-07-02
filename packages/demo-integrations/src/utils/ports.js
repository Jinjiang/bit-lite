import net from "node:net";

// Pick a TCP port for a dev server worker. The preferred port keeps the demo
// predictable, while the random fallback avoids failing if the port is occupied.
export async function findOpenPort(preferredPort) {
  // `0` means "ask the operating system for any available port".
  const preferred = Number.isInteger(preferredPort) ? preferredPort : 0;

  try {
    return await probePort(preferred);
  } catch (error) {
    // If the friendly default is busy, retry once with an OS-assigned port.
    if (preferred !== 0 && error && error.code === "EADDRINUSE") {
      return probePort(0);
    }

    throw error;
  }
}

// Temporarily bind a tiny TCP server to discover whether a port is available.
// The server is closed immediately after the chosen port is known.
function probePort(port) {
  return new Promise((resolve, reject) => {
    // This server never handles real traffic. It is only used as a port probe.
    const server = net.createServer();

    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      // When `port` is 0, Node exposes the actual selected port via address().
      const selectedPort = typeof address === "object" && address ? address.port : port;
      server.close(() => resolve(selectedPort));
    });
  });
}
