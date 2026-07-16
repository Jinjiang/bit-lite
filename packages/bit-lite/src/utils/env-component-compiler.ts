import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { Workspace, WorkspaceComponent } from "bit-lite-context";
import { orderWorkspaceComponents } from "bit-lite-context";
import { getPackageDirectory } from "../commands/link.js";

const typeScriptExtensions = new Set([".ts", ".tsx"]);
const ignoredDirectories = new Set(["node_modules", "dist", ".git"]);
const ignoredFiles = new Set([".comp.json"]);

export async function materializeLocalEnvComponents(workspace: Workspace) {
  const envComponents = workspace.components.filter((component) => component.kind === "env");
  const ordered = orderWorkspaceComponents(workspace, envComponents);
  for (const component of ordered) {
    try {
      await materializeLocalEnvComponent(workspace.rootDir, component);
    } catch (error) {
      const affected = workspace.components
        .filter((candidate) => candidate.internalEnvPackageName === component.packageName)
        .map((candidate) => candidate.id);
      throw new Error(
        `failed to materialize env "${component.packageName}@workspace:*" for components ` +
        `${affected.length > 0 ? affected.join(", ") : component.id} from ${component.rootDir}: ${formatError(error)}`
      );
    }
  }
  return ordered;
}

export async function materializeLocalEnvComponent(workspaceRoot: string, component: WorkspaceComponent) {
  if (component.kind !== "env") {
    throw new Error(`fixed env compiler cannot compile ordinary component "${component.id}"`);
  }
  const distDir = path.join(getPackageDirectory(workspaceRoot, component.packageName), "dist");
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  const sourceFiles = await collectFiles(component.rootDir);
  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(component.rootDir, sourceFile);
    const extension = path.extname(sourceFile).toLowerCase();
    if (typeScriptExtensions.has(extension) && !sourceFile.endsWith(".d.ts")) {
      await transpileEnvSupportFile(component, sourceFile, relativePath, distDir);
      continue;
    }
    await copyEnvFile(sourceFile, path.join(distDir, relativePath));
  }
  const entryPath = path.join(distDir, component.mainFileRelative);
  try {
    await readFile(entryPath, "utf8");
  } catch (error) {
    throw new Error(`fixed env compiler did not emit JSON entry for "${component.id}": ${formatError(error)}`);
  }
}

async function transpileEnvSupportFile(
  component: WorkspaceComponent,
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
    const details = ts.formatDiagnostics(errors, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => component.rootDir,
      getNewLine: () => "\n",
    });
    throw new Error(`fixed env compiler failed for "${component.id}" (${relativePath}):\n${details}`);
  }
  const outputPath = path.join(distDir, replaceExtension(relativePath, ".js"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.outputText, "utf8");
}

async function copyEnvFile(sourceFile: string, outputPath: string) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(sourceFile, outputPath);
}

async function collectFiles(rootDir: string) {
  const files: string[] = [];
  await visit(rootDir);
  return files.sort((left, right) => left.localeCompare(right));

  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      if (entry.isFile() && ignoredFiles.has(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
}

function replaceExtension(filePath: string, extension: string) {
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${extension}`);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
