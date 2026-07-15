import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ParsedCliArgs } from "bit-lite-context";
import { discoverPnpmWorkspacePackages, installDependencyProjects, type DependencyProject } from "bit-lite-deps";
import { BitLiteError } from "../utils/errors.js";
import { compileComponentPackages } from "./compile.js";
import { materializeLocalEnvComponents } from "../env-component-compiler.js";
import {
  getComponentDependencyDirectory,
  isWorkspaceProtocolSpec,
  linkComponentPackages,
  loadComponentPackageRegistry,
  sortStringRecord,
  writeJsonFile,
  type ComponentPackage,
} from "./link.js";

type DependencyManifest = {
  name: string;
  version: string;
  private: boolean;
  type: "module";
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export async function runInstallCommand(parsed: ParsedCliArgs) {
  const registry = await loadComponentPackageRegistry(parsed.workspaceRoot);
  const shouldCompile = readCompileOption(parsed.args.options.compile);
  const projects = await createDependencyProjects(registry.workspaceRoot, registry.components);
  const workspacePackages = await discoverPnpmWorkspacePackages(registry.workspaceRoot);

  await installDependencyProjects({
    rootDir: getDependencyInstallRoot(registry.workspaceRoot),
    projects,
    workspacePackages,
  });
  await linkComponentPackages(registry);
  await materializeLocalEnvComponents(registry);

  const externalRequirements = countExternalRequirements(registry.components);
  console.log(
    `Installed ${externalRequirements} external dependency requirement${externalRequirements === 1 ? "" : "s"} across ${registry.components.length} component package${registry.components.length === 1 ? "" : "s"}.`
  );
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

async function createDependencyProjects(workspaceRoot: string, components: ComponentPackage[]) {
  const installRoot = getDependencyInstallRoot(workspaceRoot);
  const rootManifest: DependencyManifest = {
    name: "bit-lite-generated-component-deps",
    version: "0.0.0",
    private: true,
    type: "module",
  };
  const projects: DependencyProject[] = [{ rootDir: installRoot, manifest: rootManifest }];
  await mkdir(installRoot, { recursive: true });
  await writeJsonFile(path.join(installRoot, "package.json"), rootManifest);

  for (const component of components) {
    const rootDir = getComponentDependencyDirectory(workspaceRoot, component.packageName);
    const manifest = createComponentDependencyManifest(component);
    await mkdir(rootDir, { recursive: true });
    await writeJsonFile(path.join(rootDir, "package.json"), manifest);
    projects.push({ rootDir, manifest });
  }

  return projects;
}

export function createComponentDependencyManifest(component: ComponentPackage): DependencyManifest {
  const runtimeDependencies = {
    ...withoutWorkspaceDependencies(component.peerDependencies),
    ...withoutWorkspaceDependencies(component.dependencies),
  };
  const devDependencies = withoutWorkspaceDependencies(component.devDependencies);
  if (!isWorkspaceProtocolSpec(component.env.version) && runtimeDependencies[component.env.packageName] === undefined) {
    devDependencies[component.env.packageName] = component.env.version;
  }
  for (const dependencyName of Object.keys(runtimeDependencies)) {
    delete devDependencies[dependencyName];
  }

  const manifest: DependencyManifest = {
    name: component.packageName,
    version: "0.0.0",
    private: true,
    type: "module",
  };
  if (Object.keys(runtimeDependencies).length > 0) {
    manifest.dependencies = sortStringRecord(runtimeDependencies);
  }
  if (Object.keys(devDependencies).length > 0) {
    manifest.devDependencies = sortStringRecord(devDependencies);
  }
  return manifest;
}

function withoutWorkspaceDependencies(dependencies: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([, version]) => !isWorkspaceProtocolSpec(version))
  );
}

function countExternalRequirements(components: ComponentPackage[]) {
  const requirements = new Set<string>();
  for (const component of components) {
    for (const dependencies of [component.dependencies, component.devDependencies, component.peerDependencies]) {
      for (const [name, version] of Object.entries(dependencies)) {
        if (!isWorkspaceProtocolSpec(version)) requirements.add(`${name}@${version}`);
      }
    }
    if (component.env && !isWorkspaceProtocolSpec(component.env.version)) {
      requirements.add(`${component.env.packageName}@${component.env.version}`);
    }
  }
  return requirements.size;
}

function getDependencyInstallRoot(workspaceRoot: string) {
  return path.join(workspaceRoot, ".bit-lite", "deps");
}
