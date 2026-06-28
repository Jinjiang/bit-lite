import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ApiKind,
  CompileOutput,
  CompileServiceResult,
  LintServiceResult,
  ServiceDiagnostic,
  ServiceRunOptions,
  TestCaseResult,
  TestServiceResult,
} from "../types/service-results.js";

const require = createRequire(import.meta.url);

export interface ResolvedServiceRunOptions {
  cwd: string;
  targetFiles: string[];
  configFile?: string;
  projectDir?: string;
  outputDir: string;
  env?: Record<string, string | undefined>;
}

function resolveFrom(baseDir: string, filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

export function resolveRunOptions(
  options: ServiceRunOptions,
  defaults: {
    cwd?: string;
    targetFiles?: string[];
    configFile?: string;
    projectDir?: string;
    outputDir?: string;
  } = {},
): ResolvedServiceRunOptions {
  const cwd = path.resolve(options?.cwd ?? defaults.cwd ?? process.cwd());
  const targetFiles = options?.targetFiles ?? defaults.targetFiles;
  if (!targetFiles?.length) {
    throw new Error("service runner requires targetFiles");
  }
  return {
    cwd,
    targetFiles: targetFiles.map((item) => resolveFrom(cwd, item) ?? item),
    configFile: resolveFrom(cwd, options?.configFile ?? defaults.configFile),
    projectDir: resolveFrom(cwd, options?.projectDir ?? defaults.projectDir),
    outputDir: resolveFrom(cwd, options?.outputDir ?? defaults.outputDir) ?? path.join(cwd, "service-results/artifacts"),
    env: options?.env,
  };
}

export function relativePath(filePath: string | undefined, baseDir = process.cwd()): string | undefined {
  if (!filePath) {
    return undefined;
  }
  if (!path.isAbsolute(filePath)) {
    return filePath.split(path.sep).join("/");
  }
  return path.relative(baseDir, filePath).split(path.sep).join("/");
}

export function createTimer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}

export function summarizeDiagnostics(diagnostics: ServiceDiagnostic[]) {
  return {
    errorCount: diagnostics.filter((item) => item.severity === "error").length,
    warningCount: diagnostics.filter((item) => item.severity === "warning").length,
    infoCount: diagnostics.filter((item) => item.severity === "info").length,
  };
}

export function summarizeTests(tests: TestCaseResult[]) {
  return {
    passed: tests.filter((item) => item.status === "passed").length,
    failed: tests.filter((item) => item.status === "failed").length,
    skipped: tests.filter((item) => item.status === "skipped").length,
    todo: tests.filter((item) => item.status === "todo").length,
    total: tests.length,
  };
}

export function summarizeCompile(outputs: CompileOutput[], diagnostics: ServiceDiagnostic[]) {
  return {
    outputCount: outputs.length,
    errorCount: diagnostics.filter((item) => item.severity === "error").length,
    warningCount: diagnostics.filter((item) => item.severity === "warning").length,
  };
}

export function packagePath(packageName: string, packageRelativePath: string): string {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  return path.join(path.dirname(packageJsonPath), packageRelativePath);
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}> {
  const elapsed = createTimer();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr, durationMs: elapsed() });
    });
  });
}

export async function withSuppressedOutput<T>(fn: () => Promise<T>): Promise<{
  value: T;
  stdout: string;
  stderr: string;
}> {
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  function capture(
    bucket: "stdout" | "stderr",
    chunk: unknown,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (bucket === "stdout") {
      stdout += text;
    } else {
      stderr += text;
    }
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    done?.();
    return true;
  }
  (process.stdout.write as unknown as typeof process.stdout.write) = ((chunk, encoding, callback) =>
    capture("stdout", chunk, encoding as BufferEncoding, callback)) as typeof process.stdout.write;
  (process.stderr.write as unknown as typeof process.stderr.write) = ((chunk, encoding, callback) =>
    capture("stderr", chunk, encoding as BufferEncoding, callback)) as typeof process.stderr.write;
  try {
    return {
      value: await fn(),
      stdout,
      stderr,
    };
  } finally {
    process.stdout.write = originalStdout as typeof process.stdout.write;
    process.stderr.write = originalStderr as typeof process.stderr.write;
  }
}

export function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  return JSON.parse(trimmed);
}

export function makeLintResult(input: {
  vendor: string;
  apiKind: ApiKind;
  ok: boolean;
  durationMs: number;
  targetFiles: string[];
  diagnostics: ServiceDiagnostic[];
  notes?: string[];
  raw?: unknown;
  baseDir?: string;
}): LintServiceResult {
  return {
    service: "lint",
    vendor: input.vendor,
    apiKind: input.apiKind,
    ok: input.ok,
    durationMs: input.durationMs,
    targetFiles: input.targetFiles.map((item) => relativePath(item, input.baseDir) ?? item),
    diagnostics: input.diagnostics,
    summary: summarizeDiagnostics(input.diagnostics),
    notes: input.notes,
    raw: input.raw,
  };
}

export function makeTestResult(input: {
  vendor: string;
  apiKind: ApiKind;
  ok: boolean;
  durationMs: number;
  targetFiles: string[];
  watchMode?: boolean;
  suites: TestServiceResult["suites"];
  tests: TestCaseResult[];
  notes?: string[];
  raw?: unknown;
  baseDir?: string;
}): TestServiceResult {
  return {
    service: "test",
    vendor: input.vendor,
    apiKind: input.apiKind,
    ok: input.ok,
    durationMs: input.durationMs,
    targetFiles: input.targetFiles.map((item) => relativePath(item, input.baseDir) ?? item),
    watchMode: input.watchMode ?? false,
    suites: input.suites,
    tests: input.tests,
    summary: summarizeTests(input.tests),
    notes: input.notes,
    raw: input.raw,
  };
}

export function makeCompileResult(input: {
  vendor: string;
  apiKind: ApiKind;
  ok: boolean;
  durationMs: number;
  targetFiles: string[];
  outputs: CompileOutput[];
  diagnostics?: ServiceDiagnostic[];
  notes?: string[];
  raw?: unknown;
  baseDir?: string;
}): CompileServiceResult {
  const diagnostics = input.diagnostics ?? [];
  return {
    service: "compile",
    vendor: input.vendor,
    apiKind: input.apiKind,
    ok: input.ok,
    durationMs: input.durationMs,
    targetFiles: input.targetFiles.map((item) => relativePath(item, input.baseDir) ?? item),
    outputs: input.outputs,
    diagnostics,
    summary: summarizeCompile(input.outputs, diagnostics),
    notes: input.notes,
    raw: input.raw,
  };
}

export async function writeArtifact(
  vendor: string,
  fileName: string,
  code: string,
  outputDir: string,
): Promise<string> {
  const outputPath = path.join(outputDir, vendor, fileName);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, code);
  return outputPath;
}

export function errorDiagnostic(error: unknown, source: string): ServiceDiagnostic {
  const value = error instanceof Error ? error : new Error(String(error));
  return {
    severity: "error",
    source,
    message: value.message,
  };
}
