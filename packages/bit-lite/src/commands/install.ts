import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ParsedCliArgs, WorkspaceComponent } from "bit-lite-context";
import { readWorkspace } from "bit-lite-context";
import { discoverPnpmWorkspacePackages, installDependencyProjects, type DependencyProject } from "bit-lite-deps";
import { BitLiteError } from "../utils/errors.js";
import { compileComponentPackages } from "./compile.js";
import {
  getComponentDependencyDirectory,
  isWorkspaceProtocolSpec,
  linkComponentPackages,
  sortStringRecord,
  writeJsonFile,
} from "./link.js";
import {
  createInstallReporter,
  type InstallReporter,
} from "./install-reporter.js";

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

export async function runInstallCommand(
  parsed: ParsedCliArgs,
  options: RunInstallCommandOptions = {}
) {
  const reporter = options.reporter ?? createInstallReporter();
  try {
    reporter.start("Reading workspace");
    let workspace;
    try {
      workspace = await readWorkspace(parsed.workspaceRoot);
      reporter.succeed(
        `Found ${workspace.components.length} component package${workspace.components.length === 1 ? "" : "s"}`
      );
    } catch (error) {
      reporter.fail("Workspace discovery failed");
      throw error;
    }

    const shouldCompile = readCompileOption(parsed.args.options.compile);
    reporter.start(
      `Preparing dependencies for ${workspace.components.length} component package${workspace.components.length === 1 ? "" : "s"}`
    );
    try {
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
      reporter.succeed(
        `Installed dependencies for ${workspace.components.length} component package${workspace.components.length === 1 ? "" : "s"}`
      );
    } catch (error) {
      reporter.fail("Dependency installation failed");
      throw error;
    }

    reporter.start(
      `Linking ${workspace.components.length} component package${workspace.components.length === 1 ? "" : "s"}`
    );
    try {
      await linkComponentPackages(workspace);
      reporter.succeed(
        `Linked ${workspace.components.length} component package${workspace.components.length === 1 ? "" : "s"}`
      );
    } catch (error) {
      reporter.fail("Component linking failed");
      throw error;
    }

    const externalRequirements = countExternalRequirements(workspace.components);
    console.log(
      `Installed ${externalRequirements} external dependency requirement${externalRequirements === 1 ? "" : "s"} across ${workspace.components.length} component package${workspace.components.length === 1 ? "" : "s"}.`
    );
    console.log(`Linked ${workspace.components.length} component package${workspace.components.length === 1 ? "" : "s"}.`);

    if (shouldCompile) {
      reporter.start(
        `Compiling ${workspace.components.length} component package${workspace.components.length === 1 ? "" : "s"}`
      );
      let compiledComponents;
      try {
        compiledComponents = await compileComponentPackages(workspace, undefined, parsed.args);
        reporter.succeed(
          `Compiled ${compiledComponents.length} component package${compiledComponents.length === 1 ? "" : "s"}`
        );
      } catch (error) {
        reporter.fail("Component compilation failed");
        throw error;
      }
      console.log(`Compiled ${compiledComponents.length} component package${compiledComponents.length === 1 ? "" : "s"}.`);
      for (const component of compiledComponents) {
        console.log(`- ${component.packageName}`);
      }
    }
  } finally {
    reporter.close();
  }
}

function readCompileOption(value: ParsedCliArgs["args"]["options"][string] | undefined) {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  throw new BitLiteError("--compile does not accept a value");
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

function getDependencyInstallRoot(workspaceRoot: string) {
  return path.join(workspaceRoot, ".bit-lite", "deps");
}
