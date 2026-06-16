import { spawn } from "node:child_process";
import type { StdioOptions } from "node:child_process";
import { spawn as spawnPty } from "node-pty";

export type RunCommandOptions = {
  cwd: string;
  args: string[];
  outputPrefix?: string;
  preserveOutputTty?: boolean;
  stdin?: "ignore" | "pipe";
  tty?: boolean;
  onProcess?: (process: { writeStdin(chunk: Buffer | string): void }) => void;
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  signal?: AbortSignal;
};

export async function runNodeScript(scriptPath: string, options: RunCommandOptions) {
  if (options.tty) return runNodeScriptInPty(scriptPath, options);
  return new Promise<number>((resolve) => {
    const stdin = options.stdin === "pipe" ? "pipe" : "ignore";
    const stdio: StdioOptions = options.preserveOutputTty
      ? ["ignore", "inherit", "inherit"]
      : options.onOutput || options.outputPrefix
        ? [stdin, "pipe", "pipe"]
        : [stdin, "inherit", "inherit"];
    const child = spawn(process.execPath, [scriptPath, ...options.args], {
      cwd: options.cwd,
      stdio,
      detached: true,
    });
    options.onProcess?.({
      writeStdin(chunk) {
        child.stdin?.write(chunk);
      },
    });
    if (!options.preserveOutputTty) {
      child.stdout?.on("data", (chunk) => writeOutput("stdout", process.stdout, options, String(chunk)));
      child.stderr?.on("data", (chunk) => writeOutput("stderr", process.stderr, options, String(chunk)));
    }
    let killTimer: NodeJS.Timeout | undefined;
    const abort = () => {
      killChildGroup(child.pid, "SIGTERM");
      killTimer = setTimeout(() => killChildGroup(child.pid, "SIGKILL"), 1000);
    };
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.on("exit", (code) => {
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      resolve(options.signal?.aborted ? 0 : code ?? 1);
    });
  });
}

async function runNodeScriptInPty(scriptPath: string, options: RunCommandOptions) {
  return new Promise<number>((resolve) => {
    const child = spawnPty(process.execPath, [scriptPath, ...options.args], {
      cwd: options.cwd,
      name: "xterm-256color",
      cols: process.stdout.columns || 120,
      rows: process.stdout.rows || 40,
    });
    options.onProcess?.({
      writeStdin(chunk) {
        child.write(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
      },
    });
    child.onData((chunk) => options.onOutput?.("stdout", chunk));
    let killTimer: NodeJS.Timeout | undefined;
    const abort = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.onExit(({ exitCode }) => {
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      resolve(options.signal?.aborted ? 0 : exitCode);
    });
  });
}

function killChildGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already exited.
    }
  }
}

function writeOutput(streamName: "stdout" | "stderr", stream: NodeJS.WriteStream, options: RunCommandOptions, chunk: string) {
  if (options.onOutput) {
    options.onOutput(streamName, chunk);
  } else if (options.outputPrefix) {
    writePrefixed(stream, options.outputPrefix, chunk);
  }
}

function writePrefixed(stream: NodeJS.WriteStream, prefix: string, value: string) {
  const lines = value.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.length === 0 && index === lines.length - 1) return;
    stream.write(`${prefix}${line}\n`);
  });
}
