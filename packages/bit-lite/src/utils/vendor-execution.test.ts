import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  EnvContext,
  PackageLocation,
  ParsedCliArgs,
  Workspace,
  WorkspaceComponent,
  WorkspaceEnvGroup,
} from "bit-lite-context";
import type { ResolvedCommandSelection } from "./command-selection.js";
import type { JsonObject, JsonValue } from "bit-lite-vendors";
import {
  createEffectiveVendorArguments,
  createEnvServiceExecutionPlan,
  createVendorWatchExecution,
  defineVendorExecution,
  getResolvedService,
  prepareResolvedServiceTaskOptions,
  runVendorExecutionPlan,
  validateVendorExecutionPlan,
} from "./vendor-execution.js";
import type {
  ImmutableCliArguments,
  OpenResolvedService,
  PlannedEnvServiceUnit,
  VendorExecutionDefinition,
  VendorExecutionPlan,
} from "./vendor-execution.js";

describe("vendor execution planning", () => {
  it("accepts compile-shaped dependency layers", () => {
    const plan = {
      layers: [
        [{ id: "compile:env", dependsOn: [], value: "env" }],
        [{ id: "compile:component", dependsOn: ["compile:env"], value: "component" }],
      ],
    };

    expect(validateVendorExecutionPlan(plan)).toBe(plan);
  });

  it.each([
    {
      name: "duplicate unit IDs",
      plan: {
        layers: [
          [{ id: "same", dependsOn: [], value: 1 }],
          [{ id: "same", dependsOn: [], value: 2 }],
        ],
      },
      message: "duplicate unit ID",
    },
    {
      name: "missing dependencies",
      plan: {
        layers: [[{ id: "consumer", dependsOn: ["missing"], value: 1 }]],
      },
      message: 'depends on missing unit "missing"',
    },
    {
      name: "same-layer dependencies",
      plan: {
        layers: [[
          { id: "first", dependsOn: [], value: 1 },
          { id: "second", dependsOn: ["first"], value: 2 },
        ]],
      },
      message: "must be in an earlier layer",
    },
    {
      name: "later-layer dependencies",
      plan: {
        layers: [
          [{ id: "first", dependsOn: ["later"], value: 1 }],
          [{ id: "later", dependsOn: [], value: 2 }],
        ],
      },
      message: "must be in an earlier layer",
    },
  ])("rejects $name", ({ plan, message }) => {
    expect(() => validateVendorExecutionPlan(plan)).toThrow(message);
  });

  it("rejects a plan without a layer", () => {
    expect(() => validateVendorExecutionPlan({ layers: [] })).toThrow(
      "must contain at least one layer"
    );
  });

  it("plans arbitrary service strings and silently skips groups without the service", () => {
    const deployA = resolvedService("deploy");
    const deployZ = resolvedService("deploy");
    const configuredA = group("env-a", { deploy: deployA });
    const configuredZ = group("env-z", { deploy: deployZ });
    const missing = group("env-missing", {});
    const selection = createSelection([configuredZ, missing, configuredA]);

    expect(getResolvedService(configuredA.env, "deploy")).toBe(deployA);
    expect(createEnvServiceExecutionPlan(selection, "deploy")).toEqual({
      layers: [[
        {
          id: 'deploy:["env-a","workspace:*"]',
          dependsOn: [],
          value: { group: configuredA, service: deployA },
        },
        {
          id: 'deploy:["env-z","workspace:*"]',
          dependsOn: [],
          value: { group: configuredZ, service: deployZ },
        },
      ]],
    });
    expect(createEnvServiceExecutionPlan(createSelection([missing]), "deploy")).toEqual({
      layers: [[]],
    });
  });

  it("rejects an empty open service identifier", () => {
    expect(() => createEnvServiceExecutionPlan(createSelection([]), "")).toThrow(
      "service ID must be non-empty"
    );
  });
});

describe("vendor execution kernel", () => {
  it("prepares resolved services with immutable effective arguments and shared task options", async () => {
    const service = resolvedService("deploy", createRunVendorUrl());
    const configured = group("env-a", { deploy: service });
    const selection = createSelection([configured]);
    const plan = createEnvServiceExecutionPlan(selection, "deploy");
    const original = selection.parsed.args;
    const args = createEffectiveVendorArguments(original, "watch");
    const planned = plan.layers[0]?.[0];
    if (!planned) throw new Error("expected planned deploy unit");

    const taskOptions = await prepareResolvedServiceTaskOptions({
      workspace: selection.context.workspace,
      args,
      unit: planned.value,
      runtime: { token: "runtime" },
    });

    expect(taskOptions.vendorUrl).toBe(service.definition.vendor);
    expect(taskOptions.context.service.name).toBe("deploy");
    expect(taskOptions.context.args).toBe(args);
    expect(taskOptions.components).toBe(configured.components);
    expect(taskOptions.config).toBe(service.definition.config);
    expect(taskOptions.runtime).toEqual({ token: "runtime" });
    expect(args.options.watch).toBe(true);
    expect(Object.isFrozen(args)).toBe(true);
    expect(Object.isFrozen(args.raw)).toBe(true);
    expect(Object.isFrozen(args.options)).toBe(true);
    expect(Object.isFrozen(args.passthrough)).toBe(true);
    expect(original.options.watch).toBeUndefined();
  });

  it("runs eligible units concurrently and isolates failed, blocked, and invalid outcomes", async () => {
    const events: string[] = [];
    (globalThis as Record<string, unknown>).__bitLiteVendorExecutionEvents = events;
    const fixture = createKernelFixture(createRunVendorUrl());
    const plan: VendorExecutionPlan<KernelUnit> = {
      layers: [
        [
          kernelPlannedUnit(fixture, "failed", [], { delay: 20, fail: true }),
          kernelPlannedUnit(fixture, "good", [], { delay: 30, valid: true }),
        ],
        [
          kernelPlannedUnit(fixture, "blocked", ["failed"], { valid: true }),
          kernelPlannedUnit(fixture, "independent", ["good"], { valid: true }),
        ],
        [
          kernelPlannedUnit(fixture, "invalid", ["good"], { valid: false }),
        ],
      ],
    };
    const definition = createKernelDefinition({
      run: {
        formatResult(value, unit) {
          return isKernelResult(value)
            ? value
            : new Error(`invalid result for ${unit.id}`);
        },
      },
    });

    const execution = await runVendorExecutionPlan({
      plan,
      definition,
      context: { workspace: fixture.selection.context.workspace, preparationEvents: [] },
      args: fixture.selection.parsed.args,
    });

    expect(execution.outcomes.map((outcome) => outcome.status)).toEqual([
      "failed",
      "successful",
      "blocked",
      "successful",
      "failed",
    ]);
    expect(execution.outcomes[2]).toMatchObject({
      status: "blocked",
      blockedBy: ["failed"],
    });
    expect(events.slice(0, 2).sort()).toEqual(["start:failed", "start:good"]);
    expect(events).not.toContain("start:blocked");
    expect(events).toContain("start:independent");
    expect(execution.args.options.watch).toBe(false);
    expect(fixture.selection.parsed.args.options.watch).toBeUndefined();
    delete (globalThis as Record<string, unknown>).__bitLiteVendorExecutionEvents;
  });

  it("creates deferred stable tasks and isolates watch preparation failures", async () => {
    const fixture = createKernelFixture(createWatchVendorUrl());
    const plan = {
      layers: [[
        kernelPlannedUnit(fixture, "good", [], { delay: 0 }),
        kernelPlannedUnit(fixture, "bad-prepare", [], { delay: 0 }),
      ]],
    };
    const definition = createKernelDefinition({
      prepareFailureId: "bad-prepare",
      watch: {
        activation: "deferred",
        formatResult: formatKernelWatchResult,
      },
    });
    const execution = await createVendorWatchExecution({
      plan,
      definition,
      context: { workspace: fixture.selection.context.workspace, preparationEvents: [] },
      args: fixture.selection.parsed.args,
    });

    try {
      expect(execution.tasks).toHaveLength(1);
      const task = execution.tasks[0]!;
      const activate = vi.spyOn(task, "activate");
      expect(task.status).toBe("idle");
      expect(execution.preparationFailures).toHaveLength(1);
      expect(execution.preparationFailures[0]?.unit.id).toBe("bad-prepare");
      const firstReadiness = execution.ensureUnitReady("good");
      const concurrentReadiness = execution.ensureUnitReady("good");
      expect(concurrentReadiness).toBe(firstReadiness);
      await expect(firstReadiness).resolves.toMatchObject({
        unit: { id: "good" },
        prepared: { metadata: { mode: "watch" } },
        task,
        result: { id: "good", ready: true },
      });
      expect(execution.ensureUnitReady("good")).toBe(firstReadiness);
      expect(activate).toHaveBeenCalledOnce();
      await expect(execution.ensureUnitReady("bad-prepare")).rejects.toThrow(
        'unit "bad-prepare" is not prepared'
      );
    } finally {
      await execution.dispose();
      await execution.dispose();
    }
  });

  it("shares aggregate disposal and continues prepared cleanup after a rejection", async () => {
    const fixture = createKernelFixture(createWatchVendorUrl());
    const cleanupEvents: string[] = [];
    const execution = await createVendorWatchExecution({
      plan: {
        layers: [[
          kernelPlannedUnit(fixture, "first", [], {}),
          kernelPlannedUnit(fixture, "second", [], {}),
        ]],
      },
      definition: createKernelDefinition({
        cleanupEvents,
        cleanupFailureId: "second",
        watch: {
          activation: "deferred",
          formatResult: formatKernelWatchResult,
        },
      }),
      context: { workspace: fixture.selection.context.workspace, preparationEvents: [] },
      args: fixture.selection.parsed.args,
    });
    const taskStops = execution.tasks.map((task) => vi.spyOn(task, "stop"));

    const firstDispose = execution.dispose();
    const concurrentDispose = execution.dispose();

    expect(concurrentDispose).toBe(firstDispose);
    await expect(firstDispose).rejects.toThrow("cleanup failed for second");
    expect(cleanupEvents).toEqual(["second", "first"]);
    expect(taskStops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    expect(execution.dispose()).toBe(firstDispose);
  });

  it("caches deferred readiness failures and stops the failed unit", async () => {
    const fixture = createKernelFixture(createFailingWatchVendorUrl());
    const plan = {
      layers: [[kernelPlannedUnit(fixture, "failed", [], {})]],
    };
    const execution = await createVendorWatchExecution({
      plan,
      definition: createKernelDefinition({
        watch: {
          activation: "deferred",
          formatResult: formatKernelWatchResult,
        },
      }),
      context: { workspace: fixture.selection.context.workspace, preparationEvents: [] },
      args: fixture.selection.parsed.args,
    });
    const task = execution.tasks[0]!;
    const activate = vi.spyOn(task, "activate");
    const stop = vi.spyOn(task, "stop");

    try {
      const firstReadiness = execution.ensureUnitReady("failed");
      expect(execution.ensureUnitReady("failed")).toBe(firstReadiness);
      await expect(firstReadiness).rejects.toThrow("watch startup failed");
      await expect(execution.ensureUnitReady("failed")).rejects.toThrow("watch startup failed");
      expect(activate).toHaveBeenCalledOnce();
      expect(stop).toHaveBeenCalledOnce();
    } finally {
      await execution.dispose();
    }
  });

  it("rejects deferred readiness before and during disposal", async () => {
    const fixture = createKernelFixture(createWatchVendorUrl());
    const createExecution = () => createVendorWatchExecution({
      plan: {
        layers: [[kernelPlannedUnit(fixture, "slow", [], { delay: 80 })]],
      },
      definition: createKernelDefinition({
        watch: {
          activation: "deferred",
          formatResult: formatKernelWatchResult,
        },
      }),
      context: { workspace: fixture.selection.context.workspace, preparationEvents: [] },
      args: fixture.selection.parsed.args,
    });

    const disposedBeforeStart = await createExecution();
    const idleTask = disposedBeforeStart.tasks[0]!;
    const activate = vi.spyOn(idleTask, "activate");
    await disposedBeforeStart.dispose();
    await expect(disposedBeforeStart.ensureUnitReady("slow")).rejects.toThrow("has been disposed");
    expect(activate).not.toHaveBeenCalled();

    const disposedDuringStart = await createExecution();
    const readiness = disposedDuringStart.ensureUnitReady("slow");
    expect(disposedDuringStart.tasks[0]?.status).toBe("starting");
    await disposedDuringStart.dispose();
    await expect(readiness).rejects.toThrow("has been disposed");
  });

  it("waits for each eager layer's first validated result before preparing the next", async () => {
    const fixture = createKernelFixture(createWatchVendorUrl());
    const plan: VendorExecutionPlan<KernelUnit> = {
      layers: [
        [kernelPlannedUnit(fixture, "first", [], { delay: 40 })],
        [kernelPlannedUnit(fixture, "second", ["first"], { delay: 0 })],
      ],
    };
    const preparationEvents: Array<{ id: string; at: number }> = [];
    const startedAt = Date.now();
    const execution = await createVendorWatchExecution({
      plan,
      definition: createKernelDefinition({
        watch: {
          activation: "eager",
          formatResult: formatKernelWatchResult,
        },
      }),
      context: { workspace: fixture.selection.context.workspace, preparationEvents },
      args: fixture.selection.parsed.args,
    });

    try {
      expect(execution.tasks).toHaveLength(2);
      expect(preparationEvents.map(({ id }) => id)).toEqual(["first", "second"]);
      expect(preparationEvents[1]!.at - startedAt).toBeGreaterThanOrEqual(25);
      await expect(execution.tasks[1]!.firstResult).resolves.toMatchObject({ id: "second" });
    } finally {
      await execution.dispose();
    }
  });

  it("rolls back already-created watch work when a later layer cannot prepare", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "bit-lite-vendor-execution-"));
    const stoppedFile = path.join(directory, "stopped.txt");
    const fixture = createKernelFixture(createWatchVendorUrl());
    const plan: VendorExecutionPlan<KernelUnit> = {
      layers: [
        [kernelPlannedUnit(fixture, "first", [], { delay: 0, stoppedFile })],
        [kernelPlannedUnit(fixture, "second", ["first"], { delay: 0 })],
      ],
    };

    await expect(createVendorWatchExecution({
      plan,
      definition: createKernelDefinition({
        prepareFailureId: "second",
        watch: {
          activation: "eager",
          formatResult: formatKernelWatchResult,
        },
      }),
      context: { workspace: fixture.selection.context.workspace, preparationEvents: [] },
      args: fixture.selection.parsed.args,
    })).rejects.toThrow("preparation failed for second");

    await expect(readFile(stoppedFile, "utf8")).resolves.toBe("stopped");
  });

  it("rejects invalid definitions before preparation", () => {
    const prepare = () => {
      throw new Error("must not prepare");
    };
    expect(() => defineVendorExecution({
      serviceId: "watch-only",
      label: "Watch",
      prepare,
      watch: {
        activation: "deferred",
        formatResult: () => [],
      },
    })).not.toThrow();
    expect(() => defineVendorExecution({
      serviceId: "empty",
      label: "Empty",
      prepare,
    })).toThrow("must support run or watch");
  });

  it("rejects deferred activation for multi-layer watch execution", async () => {
    const fixture = createKernelFixture(createWatchVendorUrl());
    const plan: VendorExecutionPlan<KernelUnit> = {
      layers: [
        [kernelPlannedUnit(fixture, "first", [], { delay: 0 })],
        [kernelPlannedUnit(fixture, "second", ["first"], { delay: 0 })],
      ],
    };

    await expect(createVendorWatchExecution({
      plan,
      definition: createKernelDefinition({
        watch: {
          activation: "deferred",
          formatResult: formatKernelWatchResult,
        },
      }),
      context: { workspace: fixture.selection.context.workspace, preparationEvents: [] },
      args: fixture.selection.parsed.args,
    })).rejects.toThrow("requires eager activation");
  });
});

function createSelection(groups: WorkspaceEnvGroup[]): ResolvedCommandSelection {
  const components = groups.flatMap((group) => group.components);
  const workspace: Workspace = {
    rootDir: "/workspace",
    configPath: "/workspace/bit-lite.json",
    config: { components: [] },
    components,
  };
  const parsed: ParsedCliArgs = {
    command: "test",
    args: { raw: ["test"], options: {}, passthrough: [] },
    workspaceRoot: workspace.rootDir,
    componentFilters: [],
    help: false,
  };
  return {
    parsed,
    context: {
      workspace,
      components: groups.flatMap((group) =>
        group.components.map((item) => ({ component: item, env: group.env }))
      ),
    },
    components,
    groups,
  };
}

function group(packageName: string, services: Record<string, unknown>): WorkspaceEnvGroup {
  const item = component(`components/${packageName}`, `@fixture/${packageName}`, packageName);
  return {
    env: {
      env: {
        packageName,
        requestedVersion: "workspace:*",
        installedVersion: "0.0.0",
      },
      package: packageLocation(packageName),
      config: undefined,
      services,
      inheritance: [],
    } as unknown as EnvContext,
    components: [item],
  };
}

function resolvedService(name: string, vendor = `${name}-vendor`) {
  return {
    name,
    definition: { vendor, config: {} },
    source: packageLocation(`source-${name}`),
  };
}

type KernelResult = JsonObject & {
  id: string;
  valid: true;
};

type KernelWatchResult = JsonObject & {
  id: string;
  ready: true;
};

type KernelUnit = PlannedEnvServiceUnit & {
  config: JsonObject;
};

type KernelContext = {
  workspace: Workspace;
  preparationEvents: Array<{ id: string; at: number }>;
};

function createKernelFixture(vendorUrl: string) {
  const service = resolvedService("custom", vendorUrl);
  const configured = group("env-kernel", { custom: service });
  return {
    selection: createSelection([configured]),
    group: configured,
    service,
  };
}

function kernelPlannedUnit(
  fixture: ReturnType<typeof createKernelFixture>,
  id: string,
  dependsOn: string[],
  config: JsonObject
) {
  return {
    id,
    dependsOn,
    value: {
      group: fixture.group,
      service: fixture.service,
      config: { id, ...config },
    },
  };
}

function createKernelDefinition(options: {
  prepareFailureId?: string;
  cleanupEvents?: string[];
  cleanupFailureId?: string;
  run?: NonNullable<
    VendorExecutionDefinition<KernelUnit, KernelContext, { mode: string }, KernelResult>["run"]
  >;
  watch?: NonNullable<
    VendorExecutionDefinition<
      KernelUnit,
      KernelContext,
      { mode: string },
      KernelResult,
      KernelWatchResult
    >["watch"]
  >;
}) {
  return defineVendorExecution<
    KernelUnit,
    KernelContext,
    { mode: string },
    KernelResult,
    KernelWatchResult
  >({
    serviceId: "custom",
    label: "Custom",
    async prepare({ unit, args, mode, context }) {
      context.preparationEvents.push({ id: unit.id, at: Date.now() });
      if (unit.id === options.prepareFailureId) {
        throw new Error(`preparation failed for ${unit.id}`);
      }
      return {
        taskOptions: await prepareResolvedServiceTaskOptions({
          workspace: context.workspace,
          args,
          unit: unit.value,
          config: unit.value.config,
          taskId: `custom:${unit.id}`,
        }),
        metadata: { mode },
      };
    },
    ...(options.cleanupEvents
      ? {
          cleanupPrepared(_prepared, unit) {
            options.cleanupEvents?.push(unit.id);
            if (unit.id === options.cleanupFailureId) {
              throw new Error(`cleanup failed for ${unit.id}`);
            }
          },
        }
      : {}),
    ...(options.run ? { run: options.run } : {}),
    ...(options.watch ? { watch: options.watch } : {}),
  });
}

function createRunVendorUrl() {
  const target = toDataModule(`
    export default async function start(runtime) {
      const events = globalThis.__bitLiteVendorExecutionEvents;
      events?.push("start:" + runtime.data.config.id);
      if (runtime.data.config.delay) {
        await new Promise((resolve) => setTimeout(resolve, runtime.data.config.delay));
      }
      if (runtime.data.config.fail) {
        events?.push("fail:" + runtime.data.config.id);
        throw new Error("failed " + runtime.data.config.id);
      }
      events?.push("end:" + runtime.data.config.id);
      return {
        data: runtime.data.config.valid
          ? { id: runtime.data.config.id, valid: true }
          : { id: runtime.data.config.id, valid: false }
      };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "kernel-run",
      label: "Kernel Run",
      hint: "Kernel run fixture",
      moduleUrl: ${JSON.stringify(target)}
    };
  `);
}

function createWatchVendorUrl() {
  const target = toDataModule(`
    import { writeFile } from "node:fs/promises";
    export default async function start(runtime) {
      if (runtime.data.config.delay) {
        await new Promise((resolve) => setTimeout(resolve, runtime.data.config.delay));
      }
      runtime.postMessage({ type: "ready" });
      runtime.postMessage({
        type: "result",
        data: { id: runtime.data.config.id, ready: true }
      });
      return {
        async stop() {
          if (runtime.data.config.stoppedFile) {
            await writeFile(runtime.data.config.stoppedFile, "stopped");
          }
        }
      };
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "kernel-watch",
      label: "Kernel Watch",
      hint: "Kernel watch fixture",
      moduleUrl: ${JSON.stringify(target)}
    };
  `);
}

function createFailingWatchVendorUrl() {
  const target = toDataModule(`
    export default async function start() {
      throw new Error("watch startup failed");
    }
  `);
  return toDataModule(`
    export const meta = {
      id: "kernel-watch-failure",
      label: "Kernel Watch Failure",
      hint: "Kernel watch failure fixture",
      moduleUrl: ${JSON.stringify(target)}
    };
  `);
}

function formatKernelWatchResult(value: unknown) {
  return isKernelWatchResult(value)
    ? [`ready:${value.id}`]
    : new Error("Invalid kernel watch result");
}

function isKernelResult(value: unknown): value is KernelResult {
  return isRecord(value) && typeof value.id === "string" && value.valid === true;
}

function isKernelWatchResult(value: unknown): value is KernelWatchResult {
  return isRecord(value) && typeof value.id === "string" && value.ready === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDataModule(source: string) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function packageLocation(packageName: string): PackageLocation {
  return {
    identity: { packageName, version: "1.0.0" },
    rootDir: `/workspace/node_modules/${packageName}`,
    entryFile: `/workspace/node_modules/${packageName}/index.json`,
  };
}

function component(id: string, packageName: string, envPackageName: string): WorkspaceComponent {
  return {
    id,
    path: id,
    rootDir: `/workspace/${id}`,
    packageName,
    kind: "component",
    env: { packageName: envPackageName, version: "workspace:*" },
    mainFile: `/workspace/${id}/index.ts`,
    mainFileRelative: "index.ts",
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [],
    internalEnvPackageName: undefined,
  };
}
