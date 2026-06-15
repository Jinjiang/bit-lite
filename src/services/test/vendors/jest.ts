import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { findFilesByKind } from "../../../file-matcher.js";
import { runNodeScript } from "../../../process.js";
import { createServiceTask } from "../../../runtime.js";
import { readObjectConfig } from "../../../service-config.js";
import type { TestVendor } from "../types.js";

const require = createRequire(import.meta.url);

export const jestTestVendor: TestVendor = {
  name: "jest",
  run(input, context) {
    let writeStdin: ((chunk: Buffer | string) => void) | undefined;
    return createServiceTask(async ({ signal, emit }) => {
      const workspaceRoot = requireWorkspaceRoot(context);
      const testFiles = await findTestFiles(input.components);
      if (testFiles.length === 0) {
        const message = `no test files found for ${context?.envName}`;
        emit("output", { stream: "stdout", chunk: `${message}\n` });
        return { ok: true, message };
      }

      const config = readObjectConfig(input.config);
      const jestPath = require.resolve("jest/bin/jest");
      const configPath = await writeJestConfig(workspaceRoot, require.resolve("typescript"));
      const watch = input.args.watch === true;
      const args = [
        "--config",
        configPath,
        "--runTestsByPath",
        ...testFiles,
        ...(watch ? ["--watchAll"] : ["--runInBand"]),
        ...readStringArray(config.args),
      ];
      emit("status", {
        status: "running",
        message: watch ? `watching jest tests for ${context?.envName}` : `running jest tests for ${context?.envName}`,
      });
      const exitCode = await runNodeScript(jestPath, {
        cwd: workspaceRoot,
        args,
        tty: watch,
        stdin: watch ? "pipe" : "ignore",
        onProcess: (process) => {
          writeStdin = process.writeStdin;
        },
        onOutput: (stream, chunk) => emit("output", { stream, chunk }),
        signal,
      });
      const result = {
        ok: exitCode === 0,
        message: exitCode === 0 ? `jest tests passed for ${context?.envName}` : `jest tests failed for ${context?.envName}`,
      };
      emit("status", { status: result.ok ? "passed" : "failed", message: result.message });
      emit("result", result);
      return result;
    }, (type, payload) => {
      if (type === "stdin") writeStdin?.(readStdinPayload(payload));
    });
  },
};

export default jestTestVendor;

function requireWorkspaceRoot(context: { workspaceRoot?: string } | undefined) {
  if (!context?.workspaceRoot) throw new Error("test requires workspaceRoot in context");
  return context.workspaceRoot;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function findTestFiles(components: Array<{ rootDir: string }>) {
  const files = await Promise.all(
    components.map(async (component) => {
      const testFiles = await findFilesByKind(component.rootDir, "test");
      const specFiles = await findFilesByKind(component.rootDir, "spec");
      return [...testFiles, ...specFiles];
    })
  );
  return files.flat().sort();
}

async function writeJestConfig(workspaceRoot: string, typescriptPath: string) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-jest-"));
  const transformerPath = path.join(tempRoot, "ts-transformer.cjs");
  const configPath = path.join(tempRoot, "jest.config.cjs");
  await writeFile(transformerPath, renderJestTransformer(typescriptPath), "utf8");
  await writeFile(
    configPath,
    `module.exports = ${JSON.stringify(
      {
        rootDir: workspaceRoot,
        testEnvironment: "node",
        transform: {
          "^.+\\.tsx?$": transformerPath,
        },
        moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
      },
      null,
      2
    )};\n`,
    "utf8"
  );
  return configPath;
}

function renderJestTransformer(typescriptPath: string) {
  return `const ts = require(${JSON.stringify(typescriptPath)});

module.exports = {
  process(source, filename) {
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        jsx: ts.JsxEmit.ReactJSX
      }
    });
    return { code: output.outputText.replace(/require\\((["'])(\\.{1,2}\\/[^"']+)\\.js\\1\\)/g, 'require($1$2.ts$1)') };
  }
};
`;
}

function readStdinPayload(payload: unknown) {
  if (Buffer.isBuffer(payload)) return payload;
  return typeof payload === "string" ? payload : "";
}
