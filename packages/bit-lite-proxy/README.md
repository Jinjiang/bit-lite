# bit-lite-proxy

`bit-lite-proxy` is the low-level HTTP and WebSocket router used by Bit Lite's development endpoints.

It uses only Node.js servers and sockets; it does not depend on a web framework.

## Define routes

```ts
import {
  ProxyServer,
  proxyHttpRequest,
  sendJson,
} from "bit-lite-proxy";

const server = new ProxyServer();

server.addRoute({
  id: "health",
  matches(url) {
    return url.pathname === "/health";
  },
  handleHttp(_request, response) {
    sendJson(response, { status: "ok" });
  },
});

server.addRoute({
  id: "application",
  matches(url) {
    return url.pathname.startsWith("/app/");
  },
  handleHttp(request, response) {
    return proxyHttpRequest(request, response, {
      origin: "http://127.0.0.1:5173",
    });
  },
});

const endpoint = await server.start("127.0.0.1", 4000);
console.log(endpoint.origin);
```

Routes are evaluated in registration order. IDs must be unique.

## WebSocket forwarding

A route can implement `handleUpgrade` and call `proxyWebSocket`:

```ts
import { proxyWebSocket } from "bit-lite-proxy";

const route = {
  id: "hmr",
  matches: () => true,
  handleHttp: () => {},
  handleUpgrade(request, socket, head) {
    proxyWebSocket(request, socket, head, {
      origin: "http://127.0.0.1:5173",
    });
  },
};
```

## Lifecycle

- `start(host, preferredPort)` scans upward from the preferred port if the address is unavailable.
- Repeated `start` calls return the existing endpoint.
- `close()` destroys tracked connections before closing the server.

Other exports include `findAvailablePort`, `encodeRouteSegment`, `sendHtml`, `sendJson`, and `sendText`.

## Package development

```bash
pnpm --filter bit-lite-proxy build
pnpm --filter bit-lite-proxy typecheck
pnpm --filter bit-lite-proxy test
```
