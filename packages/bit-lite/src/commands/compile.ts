import path from "node:path";
import type { ParsedCliArgs } from "bit-lite-context";
import {
  getPackageDirectory,
  linkComponentPackages,
  loadComponentPackageRegistry,
  orderComponentsByInternalDependencies,
  type ComponentPackage,
  type ComponentPackageRegistry,
} from "./link.js";

type CompilerVendor = {
  meta: {
    id: string;
    label: string;
  };
  compileComponent(input: {
    componentId: string;
    componentRootDir: string;
    mainFileRelative: string;
    distDir: string;
  }): Promise<void>;
};

const compilerVendorSpecifier = "demo-vendors/compilers/typescript";

export async function runCompileCommand(parsed: ParsedCliArgs) {
  if (parsed.args.positional.length > 0) {
    throw new Error("bit-lite compile currently only supports compiling all component packages");
  }

  const registry = await loadComponentPackageRegistry(parsed.workspaceRoot);
  await linkComponentPackages(registry);

  const orderedComponents = await compileComponentPackages(registry);
  printCompiledComponents(orderedComponents);
}

export async function compileComponentPackages(registry: ComponentPackageRegistry) {
  const compiler = await loadCompilerVendor();
  const orderedComponents = orderComponentsByInternalDependencies(registry);
  for (const component of orderedComponents) {
    await compiler.compileComponent({
      componentId: component.id,
      componentRootDir: component.rootDir,
      mainFileRelative: component.mainFileRelative,
      distDir: path.join(getPackageDirectory(registry.workspaceRoot, component.packageName), "dist"),
    });
  }

  return orderedComponents;
}

function printCompiledComponents(orderedComponents: ComponentPackage[]) {
  console.log(`Compiled ${orderedComponents.length} component package${orderedComponents.length === 1 ? "" : "s"}.`);
  for (const component of orderedComponents) {
    console.log(`- ${component.packageName}`);
  }
}

async function loadCompilerVendor(): Promise<CompilerVendor> {
  const vendor = (await import(compilerVendorSpecifier)) as Partial<CompilerVendor>;
  if (
    !vendor.meta ||
    typeof vendor.meta.id !== "string" ||
    typeof vendor.meta.label !== "string" ||
    typeof vendor.compileComponent !== "function"
  ) {
    throw new Error(
      `compiler vendor "${compilerVendorSpecifier}" must export meta and compileComponent()`
    );
  }
  return vendor as CompilerVendor;
}
