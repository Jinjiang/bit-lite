# demo-vite-worker

Minimal Vite Dev Server comparison:

```sh
pnpm --filter demo-vite-worker start:direct
pnpm --filter demo-vite-worker start:worker
pnpm --filter demo-vite-worker start:worker:tty
```

All commands start the same Vite server through the Node API. The worker command runs that server inside `worker_threads` and proxies the worker's stdout/stderr chunks directly to the parent terminal.

`start:worker:tty` adds a small worker-side TTY shim so Vite emits colors and clear-screen control sequences even though worker stdout is not a real TTY.

Open `http://127.0.0.1:4402/`, then edit `fixtures/vite/index.html` or `fixtures/vite/src/main.js` to compare direct output with worker-proxied output.
