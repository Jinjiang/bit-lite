import type { ComponentRef } from "bit-lite-context";
import type {
  JsonObject,
  JsonValue,
  ServiceDefinition,
  ServiceCreateTasksInput,
  ServiceTaskInput,
  ServiceVendorDefinition,
  VendorConfig,
} from "./types/index.js";

const serviceId = "test";

export const testService: ServiceDefinition = {
  id: serviceId,
  label: "Test",
  async createTasks(input) {
    const configuredTasks = await createConfiguredTasks(input);
    if (configuredTasks.length > 0) return configuredTasks;

    return input.vendors.map((vendor) => createTask(input, vendor, input.components));
  },
  formatDetails(result) {
    if (!isJsonObject(result) || result.service !== "test") return [];

    const summary = typeof result.summary === "string" ? result.summary : undefined;
    const passed = typeof result.passed === "number" ? `${result.passed} passed` : undefined;
    const failed = typeof result.failed === "number" ? `${result.failed} failed` : undefined;

    return [summary, passed, failed].filter((detail): detail is string => Boolean(detail));
  },
};

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function createConfiguredTasks(input: ServiceCreateTasksInput) {
  const selectedComponentIds = new Set(input.components.map((component) => component.id));
  const tasks: ServiceTaskInput[] = [];

  for (const group of input.context.groups) {
    const serviceConfig = readServiceConfig(group.env.services[serviceId]);
    if (!serviceConfig) continue;

    const vendor = await loadVendor(serviceConfig.vendor, group.envName);

    const components = group.components.filter((component) => selectedComponentIds.has(component.id));
    if (components.length === 0) continue;

    tasks.push(
      createTask(input, vendor, components, {
        id: `${input.mode}:${group.envName}:${vendor.id}`,
        label: `${vendor.label} (${group.envName})`,
        config: serviceConfig.config,
      })
    );
  }

  return tasks;
}

function createTask(
  input: ServiceCreateTasksInput,
  vendor: ServiceVendorDefinition,
  components: ComponentRef[],
  options: { id?: string; label?: string; config?: VendorConfig } = {}
): ServiceTaskInput {
  const config = {
    ...input.config,
    ...(vendor.config ?? {}),
    ...(options.config ?? {}),
  } satisfies VendorConfig;

  return {
    id: options.id ?? `${input.mode}:${vendor.id}`,
    label: options.label ?? vendor.label,
    vendor,
    data: {
      components,
      config,
      args: input.args,
      context: input.context,
    },
  };
}

function readServiceConfig(value: unknown): { vendor: string; config: VendorConfig } | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.vendor !== "string" || value.vendor.length === 0) {
    throw new Error(`${serviceId} service config requires a vendor import specifier`);
  }

  const vendor = value.vendor;
  const config = isRecord(value.config) ? value.config : {};
  return { vendor, config };
}

async function loadVendor(specifier: string, envName: string): Promise<ServiceVendorDefinition> {
  let vendorModule: unknown;
  try {
    vendorModule = await import(specifier);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to import ${serviceId} vendor "${specifier}" for env "${envName}": ${message}`);
  }

  if (!isRecord(vendorModule) || !isVendorDefinition(vendorModule.meta)) {
    throw new Error(`${serviceId} vendor "${specifier}" for env "${envName}" must export const meta: VendorDefinition`);
  }

  return vendorModule.meta;
}

function isVendorDefinition(value: unknown): value is ServiceVendorDefinition {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (typeof value.moduleUrl === "string" || value.moduleUrl instanceof URL)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
