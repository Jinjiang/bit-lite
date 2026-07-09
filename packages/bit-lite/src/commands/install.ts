import { spawn } from "node:child_process";
import { access, lstat, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import type { ParsedCliArgs } from "bit-lite-context";
import { BitLiteError } from "../utils/errors.js";
import { compileComponentPackages } from "./compile.js";
import {
  getPackageDirectory,
  isWorkspaceProtocolSpec,
  linkComponentPackages,
  loadComponentPackageRegistry,
  sortStringRecord,
  writeJsonFile,
  type ComponentPackage,
} from "./link.js";

type ExternalDependency = {
  name: string;
  version: string;
  sources: string[];
};

export async function runInstallCommand(parsed: ParsedCliArgs) {
  const registry = await loadComponentPackageRegistry(parsed.workspaceRoot);
  const externalDependencies = collectExternalDependencies(registry.components);
  const shouldCompile = readCompileOption(parsed.args.options.compile);

  if (externalDependencies.length > 0) {
    await installExternalDependencies(registry.workspaceRoot, externalDependencies);
    await linkExternalDependencies(registry.workspaceRoot, externalDependencies);
  }

  await linkComponentPackages(registry);

  console.log(`Installed ${externalDependencies.length} external dependenc${externalDependencies.length === 1 ? "y" : "ies"}.`);
  console.log(`Linked ${registry.components.length} component package${registry.components.length === 1 ? "" : "s"}.`);

  if (shouldCompile) {
    const compiledComponents = await compileComponentPackages(registry);
    console.log(`Compiled ${compiledComponents.length} component package${compiledComponents.length === 1 ? "" : "s"}.`);
    for (const component of compiledComponents) {
      console.log(`- ${component.packageName}`);
    }
  }
}

function readCompileOption(value: ParsedCliArgs["args"]["options"][string] | undefined) {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  throw new BitLiteError("--compile does not accept a value");
}

function collectExternalDependencies(components: ComponentPackage[]): ExternalDependency[] {
  const externalDependencies = new Map<string, ExternalDependency>();

  for (const component of components) {
    collectDependencyMap(externalDependencies, component, "dependencies", component.dependencies);
    collectDependencyMap(externalDependencies, component, "devDependencies", component.devDependencies);
    collectDependencyMap(externalDependencies, component, "peerDependencies", component.peerDependencies);

    if (component.env && !isWorkspaceProtocolSpec(component.env.version)) {
      addExternalDependency(externalDependencies, component.env.packageName, component.env.version, `${component.id}:env`);
    }
  }

  return [...externalDependencies.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function collectDependencyMap(
  externalDependencies: Map<string, ExternalDependency>,
  component: ComponentPackage,
  field: string,
  dependencies: Record<string, string>
) {
  for (const [name, version] of Object.entries(dependencies)) {
    if (isWorkspaceProtocolSpec(version)) continue;
    addExternalDependency(externalDependencies, name, version, `${component.id}:${field}`);
  }
}

function addExternalDependency(
  externalDependencies: Map<string, ExternalDependency>,
  name: string,
  version: string,
  source: string
) {
  const existing = externalDependencies.get(name);
  if (existing) {
    if (existing.version !== version) {
      throw new BitLiteError(
        `conflicting external dependency "${name}": ${existing.version} (${existing.sources.join(
          ", "
        )}) vs ${version} (${source})`
      );
    }
    existing.sources.push(source);
    return;
  }

  externalDependencies.set(name, {
    name,
    version,
    sources: [source],
  });
}

async function installExternalDependencies(workspaceRoot: string, dependencies: ExternalDependency[]) {
  const depsDir = path.join(workspaceRoot, ".bit-lite", "deps");
  await mkdir(depsDir, { recursive: true });
  await writeJsonFile(path.join(depsDir, "package.json"), {
    name: "bit-lite-generated-component-deps",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: sortStringRecord(
      Object.fromEntries(dependencies.map((dependency) => [dependency.name, dependency.version]))
    ),
  });

  await runPnpmInstall(depsDir);
}

async function linkExternalDependencies(workspaceRoot: string, dependencies: ExternalDependency[]) {
  const depsNodeModules = path.join(workspaceRoot, ".bit-lite", "deps", "node_modules");
  for (const dependency of dependencies) {
    const source = path.join(depsNodeModules, ...dependency.name.split("/"));
    await assertPathExists(source, `pnpm did not install ${dependency.name}`);
    const destination = getPackageDirectory(workspaceRoot, dependency.name);
    await replaceSymlink(destination, source);
  }
}

async function replaceSymlink(destination: string, source: string) {
  await mkdir(path.dirname(destination), { recursive: true });

  try {
    const stats = await lstat(destination);
    if (!stats.isSymbolicLink()) {
      throw new BitLiteError(`cannot link dependency at ${destination}: path already exists and is not a symlink`);
    }
    await rm(destination, { recursive: true, force: true });
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
  }

  const relativeSource = path.relative(path.dirname(destination), source);
  await symlink(relativeSource, destination, "dir");
}

async function runPnpmInstall(depsDir: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", [
      "--pm-on-fail=ignore",
      "install",
      "--dir",
      depsDir,
      "--ignore-workspace",
      "--ignore-scripts",
    ], {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new BitLiteError(`pnpm install failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
    });
  });
}

async function assertPathExists(filePath: string, message: string) {
  try {
    await access(filePath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) throw new BitLiteError(message);
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}
