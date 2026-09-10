import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  getComponentDependencyDirectory,
  getDependencyInstallRoot,
  isWorkspaceProtocolSpec,
  readWorkspace,
} from "bit-lite-context";
import { discoverPnpmWorkspacePackages, installDependencyProjects } from "bit-lite-deps";
import { countOf, sortStringRecord } from "bit-lite-utils";
import type { DependencyProject } from "bit-lite-deps";
import type { WorkspaceComponent } from "bit-lite-context";
import type { ParsedCliArgs } from "../cli/arg-types.js";
import { readFlagOption } from "../cli/options.js";
import { compileComponentPackages } from "./compile.js";
import { createInstallReporter, type InstallReporter } from "./install-reporter.js";
import { linkComponentPackages, writeJsonFile } from "./link.js";

type DependencyManifest = {
  name: string;
  version: string;
  private: boolean;
  type: "module";
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type RunInstallCommandOptions = {
  reporter?: InstallReporter;
};

/**
 * Prepares every component to be developed against: an isolated dependency
 * project per component, its external requirements installed, and the workspace
 * components linked in as packages.
 *
 * Each phase reports through the reporter before it runs and either succeeds or
 * fails it, so an interrupted install says which phase it was in.
 */
export async function runInstallCommand(
  parsed: ParsedCliArgs,
  options: RunInstallCommandOptions = {}
) {
  const reporter = options.reporter ?? createInstallReporter();
  const shouldCompile = readFlagOption(parsed.args.options.compile, "--compile");

  try {
    const workspace = await phase(
      reporter,
      "Reading workspace",
      "Workspace discovery failed",
      async () => await readWorkspace(parsed.workspaceRoot),
      (result) => `Found ${countOf(result.components.length, "component package")}`
    );
    const packageCount = countOf(workspace.components.length, "component package");

    await phase(
      reporter,
      `Preparing dependencies for ${packageCount}`,
      "Dependency installation failed",
      async () => {
        const projects = await createDependencyProjects(workspace.rootDir, workspace.components);
        // Temporary demo bridge: reuse locally developed packages when this Bit workspace
        // happens to be nested in a pnpm workspace. Its absence is normal; production Bit
        // component installation is expected to resolve through a dedicated npm registry.
        const workspacePackages = await discoverPnpmWorkspacePackages(workspace.rootDir);
        reporter.update("Installing dependencies");
        await installDependencyProjects({
          rootDir: getDependencyInstallRoot(workspace.rootDir),
          projects,
          workspacePackages,
          onProgress: (event) => reporter.dependency(event),
        });
      },
      () => `Installed dependencies for ${packageCount}`
    );

    await phase(
      reporter,
      `Linking ${packageCount}`,
      "Component linking failed",
      () => linkComponentPackages(workspace),
      () => `Linked ${packageCount}`
    );

    const requirements = countExternalRequirements(workspace.components);
    console.log(
      `Installed ${countOf(requirements, "external dependency requirement")} across ${packageCount}.`
    );
    console.log(`Linked ${packageCount}.`);

    if (shouldCompile) {
      const compiled = await phase(
        reporter,
        `Compiling ${packageCount}`,
        "Component compilation failed",
        () => compileComponentPackages(workspace, undefined, parsed.args),
        (result) => `Compiled ${countOf(result.length, "component package")}`
      );
      console.log(`Compiled ${countOf(compiled.length, "component package")}.`);
      for (const component of compiled) console.log(`- ${component.packageName}`);
    }
  } finally {
    reporter.close();
  }
}

async function phase<Result>(
  reporter: InstallReporter,
  start: string,
  failure: string,
  run: () => Promise<Result>,
  describe: (result: Result) => string
): Promise<Result> {
  reporter.start(start);
  try {
    const result = await run();
    reporter.succeed(describe(result));
    return result;
  } catch (error) {
    reporter.fail(failure);
    throw error;
  }
}

async function createDependencyProjects(workspaceRoot: string, components: readonly WorkspaceComponent[]) {
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

export function createComponentDependencyManifest(component: WorkspaceComponent): DependencyManifest {
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

function countExternalRequirements(components: readonly WorkspaceComponent[]) {
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
