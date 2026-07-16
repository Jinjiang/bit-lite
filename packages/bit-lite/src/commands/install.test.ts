import { describe, expect, it } from "vitest";
import type { WorkspaceComponent } from "bit-lite-context";
import { createComponentDependencyManifest } from "./install.js";

describe("component dependency manifests", () => {
  it("derives external envs as development dependencies", () => {
    const manifest = createComponentDependencyManifest(component({
      env: { packageName: "@scope/env.node", version: "^1.2.0" },
      devDependencies: { vitest: "^4.0.0" },
    }));
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toEqual({
      "@scope/env.node": "^1.2.0",
      vitest: "^4.0.0",
    });
  });

  it("keeps local env tooling out of dependency manifests", () => {
    const manifest = createComponentDependencyManifest(component({
      env: { packageName: "@scope/env.local", version: "workspace:*" },
      internalEnvPackageName: "@scope/env.local",
    }));
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
  });

  it("emits a dual-role inherited parent once as a runtime dependency", () => {
    const manifest = createComponentDependencyManifest(component({
      env: { packageName: "@scope/env.node", version: "1.0.0" },
      dependencies: { "@scope/env.node": "1.0.0" },
      devDependencies: { "@scope/env.node": "1.0.0" },
    }));
    expect(manifest.dependencies).toEqual({ "@scope/env.node": "1.0.0" });
    expect(manifest.devDependencies).toBeUndefined();
  });
});

function component(overrides: Partial<WorkspaceComponent>): WorkspaceComponent {
  return {
    id: "lib/math",
    path: "components/lib/math",
    rootDir: "/workspace/components/lib/math",
    packageName: "@scope/lib.math",
    kind: "component",
    env: { packageName: "@scope/env.node", version: "1.0.0" },
    mainFile: "/workspace/components/lib/math/index.ts",
    mainFileRelative: "index.ts",
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [],
    internalEnvPackageName: undefined,
    ...overrides,
  };
}
