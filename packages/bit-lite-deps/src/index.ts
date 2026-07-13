import { getConfig } from "@pnpm/config";
import { mutateModules, type InstallOptions, type MutatedProject, type ProjectOptions } from "@pnpm/core";
import { createOrConnectStoreController } from "@pnpm/store-connection-manager";
import type { ProjectManifest, ProjectRootDir } from "@pnpm/types";
import { finishWorkers, restartWorkerPool } from "@pnpm/worker";

export type DependencyProject = {
  rootDir: string;
  manifest: ProjectManifest;
};

export type InstallDependencyProjectsOptions = {
  rootDir: string;
  projects: DependencyProject[];
};

export async function installDependencyProjects(options: InstallDependencyProjectsOptions) {
  const { config } = await getConfig({
    cliOptions: {
      dir: options.rootDir,
      ignoreScripts: true,
    },
    packageManager: {
      name: "pnpm",
      version: "11.7.0",
    },
  });
  const store = await createOrConnectStoreController({
    ...config,
    dir: options.rootDir,
    workspaceDir: options.rootDir,
  });
  const allProjects: ProjectOptions[] = options.projects.map((project) => ({
    buildIndex: 0,
    manifest: project.manifest,
    rootDir: project.rootDir as ProjectRootDir,
  }));
  const mutations: MutatedProject[] = options.projects.map((project) => ({
    rootDir: project.rootDir as ProjectRootDir,
    mutation: "install",
  }));
  const installOptions: InstallOptions = {
    allProjects,
    autoInstallPeers: false,
    autoInstallPeersFromHighestMatch: false,
    confirmModulesPurge: false,
    dedupeDirectDeps: true,
    dedupePeerDependents: true,
    depth: 0,
    dir: options.rootDir,
    enableModulesDir: true,
    excludeLinksFromLockfile: true,
    hoistPattern: [],
    ignoreScripts: true,
    include: {
      dependencies: true,
      devDependencies: true,
      optionalDependencies: true,
    },
    injectWorkspacePackages: false,
    lockfileOnly: false,
    modulesCacheMaxAge: Infinity,
    nodeLinker: "isolated",
    preferFrozenLockfile: true,
    pruneLockfileImporters: true,
    rawConfig: config.rawConfig,
    registries: config.registries,
    resolutionMode: "highest",
    resolvePeersFromWorkspaceRoot: false,
    storeController: store.ctrl,
    storeDir: store.dir,
    strictPeerDependencies: false,
  };

  try {
    await restartWorkerPool();
    await mutateModules(mutations, installOptions);
  } finally {
    await finishWorkers();
  }
}
