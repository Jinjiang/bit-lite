import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CompileVendorInput,
  CompileVendorRuntime,
  CompilerVendorStart,
} from "bit-lite-compiler";
import type {
  VendorDefinition,
} from "bit-lite-vendors";
import { startCompilerWatch } from "../watch.js";

type TypeScriptModule = typeof import("typescript");

export type TypeScriptCompileRuntime = CompileVendorRuntime;

export type TypeScriptCompileInput = CompileVendorInput;

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const staticAssetExtensions = new Set([".vue", ".css", ".scss", ".sass", ".less", ".json"]);
const ignoredSourceNameFragments = [".test.", ".spec."];
const ignoredSourceNames = new Set([".comp.json", "preview.ts", "preview.tsx", "lint-demo.ts"]);

export const meta: VendorDefinition = {
  id: "typescript-compiler",
  label: "TypeScript Compiler",
  hint: "Compile component packages with TypeScript",
  moduleUrl: import.meta.url,
};

const startTypeScriptCompiler: CompilerVendorStart = async (runtime) => {
  if (runtime.data.context.args.options.watch === true) {
    return startCompilerWatch(runtime, compileOnce);
  }
  const output = await compileOnce(runtime.data);
  return { data: { output: output ?? null } };
};

export default startTypeScriptCompiler;

async function compileOnce(input: TypeScriptCompileInput) {
  const component = input.components[0];
  const runtime = input.runtime;
  if (!component || input.components.length !== 1 || !runtime) {
    throw new Error("TypeScript compiler requires exactly one component and compile runtime");
  }
  const ts = await import("typescript");
  await rm(runtime.distDir, { recursive: true, force: true });
  await mkdir(runtime.distDir, { recursive: true });

  const sourceFiles = await findComponentSourceFiles(component.rootDir);
  for (const sourceFile of sourceFiles) {
    const extension = path.extname(sourceFile);

    if (sourceExtensions.has(extension) && !sourceFile.endsWith(".d.ts")) {
      await transpileSourceFile(ts, component.rootDir, sourceFile, runtime.distDir);
      continue;
    }

    if (staticAssetExtensions.has(extension) || sourceFile.endsWith(".d.ts")) {
      await copyStaticFile(component.rootDir, sourceFile, runtime.distDir);
    }
  }

  await ensureEntryDeclaration(runtime);
  return { artifactCount: sourceFiles.length };
}

async function transpileSourceFile(
  ts: TypeScriptModule,
  componentRootDir: string,
  sourceFile: string,
  distDir: string
) {
  const source = await readFile(sourceFile, "utf8");
  const extension = path.extname(sourceFile);
  const transpiled = ts.transpileModule(source, {
    fileName: sourceFile,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      sourceMap: false,
    },
    reportDiagnostics: true,
  });

  const diagnostics = transpiled.diagnostics ?? [];
  const blockingDiagnostics = diagnostics.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (blockingDiagnostics.length > 0) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(blockingDiagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => componentRootDir,
      getNewLine: () => "\n",
    });
    throw new Error(formatted);
  }

  const relativePath = path.relative(componentRootDir, sourceFile);
  const outputPath = path.join(
    distDir,
    replaceExtension(relativePath, extensionToJavaScriptExtension(extension))
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, transpiled.outputText, "utf8");

  if (extension === ".ts" || extension === ".tsx") {
    await writeDeclarationFile(componentRootDir, sourceFile, distDir, source);
  }
}

async function writeDeclarationFile(
  componentRootDir: string,
  sourceFile: string,
  distDir: string,
  source: string
) {
  const relativePath = path.relative(componentRootDir, sourceFile);
  const declarationPath = path.join(distDir, replaceExtension(relativePath, ".d.ts"));
  const sourceModulePath = toPosixPath(path.join("..", "src", stripKnownExtension(relativePath)));
  const lines = [`export * from "${sourceModulePath}";`];
  if (hasDefaultExport(source)) {
    lines.push(`export { default } from "${sourceModulePath}";`);
  }
  await mkdir(path.dirname(declarationPath), { recursive: true });
  await writeFile(declarationPath, `${lines.join("\n")}\n`, "utf8");
}

async function copyStaticFile(componentRootDir: string, sourceFile: string, distDir: string) {
  const outputPath = path.join(distDir, path.relative(componentRootDir, sourceFile));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(sourceFile, outputPath);
}

async function ensureEntryDeclaration(input: TypeScriptCompileRuntime) {
  const entryDeclarationPath = path.join(input.distDir, "index.d.ts");
  const mainExtension = path.extname(input.mainFileRelative);
  if (mainExtension === ".ts" || mainExtension === ".tsx") return;

  const sourceModulePath = toPosixPath(
    path.join("..", "src", stripKnownExtension(input.mainFileRelative))
  );
  await writeFile(entryDeclarationPath, `export * from "${sourceModulePath}";\n`, "utf8");
}

async function findComponentSourceFiles(componentRootDir: string) {
  const results: string[] = [];
  await collectFiles(componentRootDir, results);
  return results.sort((left, right) => left.localeCompare(right));
}

async function collectFiles(dir: string, results: string[]) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      await collectFiles(entryPath, results);
      continue;
    }

    if (entry.isFile() && shouldCompileFile(entry.name)) results.push(entryPath);
  }
}

function shouldCompileFile(fileName: string) {
  if (ignoredSourceNames.has(fileName)) return false;
  if (ignoredSourceNameFragments.some((fragment) => fileName.includes(fragment))) return false;
  const extension = path.extname(fileName);
  return sourceExtensions.has(extension) || staticAssetExtensions.has(extension);
}

function extensionToJavaScriptExtension(extension: string) {
  if (extension === ".mjs" || extension === ".cjs") return extension;
  return ".js";
}

function replaceExtension(filePath: string, extension: string) {
  return path.join(
    path.dirname(filePath),
    `${path.basename(filePath, path.extname(filePath))}${extension}`
  );
}

function stripKnownExtension(filePath: string) {
  return toPosixPath(filePath).replace(/\.(tsx?|jsx?|mjs|cjs|vue)$/, "");
}

function hasDefaultExport(source: string) {
  return /\bexport\s+default\b/.test(source) || /\bexport\s*\{\s*default\b/.test(source);
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}
