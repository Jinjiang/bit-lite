#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtEntry = resolve(packageRoot, "dist/bin.js");

if (!existsSync(builtEntry)) {
  console.error(
    "bit-lite has not been built yet. Run `pnpm --filter bit-lite build` before invoking the CLI.",
  );
  process.exitCode = 1;
} else {
  await import(pathToFileURL(builtEntry).href);
}
