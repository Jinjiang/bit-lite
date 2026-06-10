import { spawn } from "node:child_process";
import type { StdioOptions } from "node:child_process";

export type RunCommandOptions = {
  cwd: string;
  args: string[];
  outputPrefix?: string;
  preserveOutputTty?: boolean;
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  signal?: AbortSignal;
};

export async function runNodeScript(scriptPath: string, options: RunCommandOptions) {
  return new Promise<number>((resolve) => {
    const stdio: StdioOptions = options.preserveOutputTty
      ? ["ignore", "inherit", "inherit"]
      : options.onOutput || options.outputPrefix
        ? ["ignore", "pipe", "pipe"]
        : "inherit";
    const child = spawn(process.execPath, [scriptPath, ...options.args], {
      cwd: options.cwd,
      stdio,
    });
    if (!options.preserveOutputTty) {
      child.stdout?.on("data", (chunk) => writeOutput("stdout", process.stdout, options, String(chunk)));
      child.stderr?.on("data", (chunk) => writeOutput("stderr", process.stderr, options, String(chunk)));
    }
    const abort = () => child.kill();
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.on("exit", (code) => {
      options.signal?.removeEventListener("abort", abort);
      resolve(options.signal?.aborted ? 0 : code ?? 1);
    });
  });
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
