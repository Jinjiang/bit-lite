import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import {
  flattenEnvDefinition,
  isCompiledEnvDefinition,
  validateCompiledEnvDefinition,
  validateEnvDefinition,
} from "bit-lite-env";
import type { CompiledEnvDefinition } from "bit-lite-env";
import type {
  CompileVendorInput,
  CompilerVendorStart,
} from "bit-lite-compiler";
import type {
  VendorDefinition,
} from "bit-lite-vendors";
import {
  isRecord,
  readDefaultExport,
  readStringRecord,
} from "bit-lite-utils";
import { collectFiles, replaceExtension } from "bit-lite-utils/node";
import { startCompilerWatch } from "../watch.js";

const typeScriptExtensions = new Set([".ts", ".tsx"]);
const ignoredDirectories = new Set(["node_modules", "dist", ".git"]);
const ignoredFiles = new Set([".comp.json"]);

export const meta: VendorDefinition = {
  id: "env-compiler",
  label: "Environment Compiler",
  hint: "Compile flattened environment packages",
  moduleUrl: import.meta.url,
};

const startEnvCompiler: CompilerVendorStart = async (runtime) => {
  if (runtime.data.context.args.options.watch === true) {
    return startCompilerWatch(runtime, compileOnce);
  }
  const output = await compileOnce(runtime.data);
  return { data: { output: output ?? null } };
};

export default startEnvCompiler;

async function compileOnce(input: CompileVendorInput) {
  const component = input.components[0];
  const runtime = input.runtime;
  if (!component || input.components.length !== 1 || !runtime) {
    throw new Error("Environment compiler requires exactly one component and compile runtime");
  }

  const sourceEntry = path.join(component.rootDir, runtime.mainFileRelative);
  const definition = await compileDefinition(
    sourceEntry,
    component.packageName,
    component.rootDir,
    component.dependencies,
    []
  );
  await rm(runtime.distDir, { recursive: true, force: true });
  await mkdir(runtime.distDir, { recursive: true });

  const sourceFiles = await collectFiles(component.rootDir, {
    ignoredDirectories,
    ignoredFiles,
    order: "sorted",
  });
  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(component.rootDir, sourceFile);
    if (path.resolve(sourceFile) === path.resolve(sourceEntry)) continue;
    const extension = path.extname(sourceFile).toLowerCase();
    if (typeScriptExtensions.has(extension) && !sourceFile.endsWith(".d.ts")) {
      await transpileSupportFile(component.rootDir, sourceFile, relativePath, runtime.distDir);
      continue;
    }
    await copySupportFile(sourceFile, path.join(runtime.distDir, relativePath));
  }

  await writeFile(
    path.join(runtime.distDir, "index.json"),
    `${JSON.stringify(definition, null, 2)}\n`,
    "utf8"
  );
  return { artifactCount: sourceFiles.length, formatVersion: definition.formatVersion };
}

async function compileDefinition(
  entryFile: string,
  packageName: string,
  packageRoot: string,
  dependencies: Record<string, string>,
  stack: string[]
): Promise<CompiledEnvDefinition> {
  if (stack.includes(packageName)) {
    throw new Error(`env inheritance cycle detected: ${[...stack, packageName].join(" -> ")}`);
  }
  const parsed = JSON.parse(await readFile(entryFile, "utf8")) as unknown;
  if (isCompiledEnvDefinition(parsed)) return validateCompiledEnvDefinition(parsed, packageName);
  const source = validateEnvDefinition(parsed, packageName);
  if (!source.extends) return flattenEnvDefinition(source);
  if (dependencies[source.extends] === undefined) {
    throw new Error(
      `env "${source.name}" extends "${source.extends}" but it is not declared in dependencies`
    );
  }

  const parent = await resolveDependencyEnv(packageRoot, source.extends);
  const parentDefinition = await compileDefinition(
    parent.entryFile,
    source.extends,
    parent.packageRoot,
    parent.dependencies,
    [...stack, packageName]
  );
  return flattenEnvDefinition(source, parentDefinition);
}

async function resolveDependencyEnv(packageRoot: string, packageName: string) {
  const dependencyRoot = path.join(packageRoot, "node_modules", ...packageName.split("/"));
  const manifest = JSON.parse(await readFile(path.join(dependencyRoot, "package.json"), "utf8")) as unknown;
  if (!isRecord(manifest) || manifest.name !== packageName) {
    throw new Error(`env dependency "${packageName}" has an invalid package manifest at ${dependencyRoot}`);
  }
  const entry = readDefaultExport(manifest, {
    createMissingExportError: () =>
      new Error(`env dependency "${packageName}" does not define a default export`),
  });
  return {
    packageRoot: dependencyRoot,
    entryFile: path.resolve(dependencyRoot, entry),
    dependencies: readStringRecord(manifest.dependencies),
  };
}

async function transpileSupportFile(
  componentRoot: string,
  sourceFile: string,
  relativePath: string,
  distDir: string
) {
  const source = await readFile(sourceFile, "utf8");
  const result = ts.transpileModule(source, {
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
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (errors.length > 0) {
    throw new Error(ts.formatDiagnostics(errors, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => componentRoot,
      getNewLine: () => "\n",
    }));
  }
  const outputPath = path.join(distDir, replaceExtension(relativePath, ".js"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.outputText, "utf8");
}

async function copySupportFile(sourceFile: string, outputPath: string) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(sourceFile, outputPath);
}
