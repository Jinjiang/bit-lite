import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/** Keeps error messages useful without buffering an unbounded amount of CLI output. */
const MAX_STDERR_CHARS = 8_000;

export type RunPnpmInstallOptions = {
  /** Generated install root; also the root of the generated pnpm workspace. */
  cwd: string;
  /**
   * Workspace-relative paths of the projects to install. Members left out stay
   * linkable but are never written to, which keeps an enclosing repository's own
   * `node_modules` out of this install.
   */
  filters: string[];
  /** Receives raw ndjson chunks from the CLI's stdout. */
  onOutput?: (chunk: string) => void;
};

/**
 * Resolves the CLI entry of the pinned `pnpm` dependency rather than whatever
 * `pnpm` happens to be on PATH, so installs do not depend on the host toolchain.
 * The package exports only its own manifest, which is the supported way to
 * locate the installation directory.
 */
export function resolvePnpmCliEntry() {
  return path.join(path.dirname(require.resolve("pnpm")), "bin", "pnpm.mjs");
}

export async function runPnpmInstall(options: RunPnpmInstallOptions) {
  const args = [
    resolvePnpmCliEntry(),
    "install",
    "--reporter=ndjson",
    "--ignore-scripts",
    // The lockfile is regenerated from manifests bit-lite writes, so a stale
    // lockfile must resolve rather than fail the way CI defaults would.
    "--no-frozen-lockfile",
    ...options.filters.flatMap((filter) => ["--filter", filter]),
  ];

  return await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: createInstallEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => options.onOutput?.(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_CHARS);
    });

    child.on("error", (error) => {
      settle(new Error(`Failed to start pnpm install: ${error.message}`, { cause: error }));
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        settle();
        return;
      }
      settle(new Error(describeFailure(code, signal, stderr)));
    });
  });
}

function describeFailure(code: number | null, signal: NodeJS.Signals | null, stderr: string) {
  const reason = signal === null ? `exit code ${code ?? "unknown"}` : `signal ${signal}`;
  const details = stderr.trim();
  return details === ""
    ? `pnpm install failed with ${reason}`
    : `pnpm install failed with ${reason}\n${details}`;
}

/**
 * Drops `npm_config_*` variables injected when bit-lite itself runs inside an
 * npm or pnpm script, since they would silently override the settings written
 * to the generated workspace file.
 */
function createInstallEnv() {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase().startsWith("npm_config_")) continue;
    env[key] = value;
  }
  return env;
}
