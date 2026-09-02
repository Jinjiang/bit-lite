import { describe, expect, it } from "vitest";
import type { WorkspaceComponent } from "bit-lite-context";
import {
  projectComponentConfig,
  serializeProjectedComponentConfig,
} from "./component-projection.js";

const versions: Record<string, string> = {
  "@scope/lib.math": "0.0.0-gc4b8e12",
  "@scope/env.react": "0.0.0-g9d02f7a",
};
const resolveVersion = (packageName: string) => versions[packageName];

describe("component config projection", () => {
  it("resolves a workspace placeholder dependency to its recorded version", () => {
    const projected = projectComponentConfig(
      { dependencies: { "@scope/lib.math": "workspace:*" } },
      { component: component(), resolveVersion }
    );

    expect(projected.dependencies).toEqual({ "@scope/lib.math": "0.0.0-gc4b8e12" });
    expect(JSON.stringify(projected)).not.toContain("workspace:");
  });

  it("leaves external dependency specifiers exactly as declared", () => {
    const projected = projectComponentConfig(
      {
        dependencies: { clsx: "^2.1.0" },
        devDependencies: { vitest: "^4.1.8" },
        peerDependencies: { react: "^19.2.7" },
      },
      { component: component(), resolveVersion }
    );

    expect(projected.dependencies).toEqual({ clsx: "^2.1.0" });
    expect(projected.devDependencies).toEqual({ vitest: "^4.1.8" });
    expect(projected.peerDependencies).toEqual({ react: "^19.2.7" });
  });

  it("resolves placeholders across every dependency field", () => {
    const projected = projectComponentConfig(
      {
        dependencies: { "@scope/lib.math": "workspace:*" },
        devDependencies: { "@scope/lib.math": "workspace:*" },
        peerDependencies: { "@scope/lib.math": "workspace:*" },
      },
      { component: component(), resolveVersion }
    );

    for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      expect(projected[field]).toEqual({ "@scope/lib.math": "0.0.0-gc4b8e12" });
    }
  });

  it("injects a local env as the env component's recorded version", () => {
    const projected = projectComponentConfig(
      {},
      {
        component: component({ env: { packageName: "@scope/env.react", version: "workspace:*" } }),
        resolveVersion,
      }
    );

    expect(projected.env).toEqual({
      packageName: "@scope/env.react",
      version: "0.0.0-g9d02f7a",
    });
  });

  it("injects an external env as the specifier bit-lite.json declares", () => {
    const projected = projectComponentConfig(
      {},
      {
        component: component({ env: { packageName: "demo-env-node", version: "0.0.0" } }),
        resolveVersion: () => {
          throw new Error("an external env must not require version resolution");
        },
      }
    );

    expect(projected.env).toEqual({ packageName: "demo-env-node", version: "0.0.0" });
  });

  it("keeps a component with no dependencies projectable", () => {
    const projected = projectComponentConfig({}, { component: component(), resolveVersion });

    expect(projected).toEqual({ env: { packageName: "demo-env-node", version: "0.0.0" } });
  });

  it("preserves fields it does not understand", () => {
    const projected = projectComponentConfig(
      { kind: "env", future: { nested: true } },
      { component: component(), resolveVersion }
    );

    expect(projected.kind).toBe("env");
    expect(projected.future).toEqual({ nested: true });
  });

  it("overwrites an authored env field with the resolved reference", () => {
    const projected = projectComponentConfig(
      { env: { packageName: "stale", version: "0.0.1" } },
      { component: component(), resolveVersion }
    );

    expect(projected.env).toEqual({ packageName: "demo-env-node", version: "0.0.0" });
  });

  it("fails when a placeholder has no resolved version", () => {
    expect(() =>
      projectComponentConfig(
        { dependencies: { "@scope/unknown": "workspace:*" } },
        { component: component(), resolveVersion }
      )
    ).toThrow('component "ui/button" has no resolved version for workspace dependency "@scope/unknown"');
  });

  it("rejects a malformed dependency record", () => {
    expect(() =>
      projectComponentConfig({ dependencies: [] }, { component: component(), resolveVersion })
    ).toThrow('dependencies for component "ui/button" must be an object');

    expect(() =>
      projectComponentConfig(
        { dependencies: { clsx: 2 } },
        { component: component(), resolveVersion }
      )
    ).toThrow('dependency "clsx" for component "ui/button" must have a version string');
  });

  it("serializes identical state to identical bytes regardless of authored key order", () => {
    const first = projectComponentConfig(
      {
        peerDependencies: { react: "^19.2.7" },
        dependencies: { "@scope/lib.math": "workspace:*", clsx: "^2.1.0" },
      },
      { component: component(), resolveVersion }
    );
    const second = projectComponentConfig(
      {
        dependencies: { clsx: "^2.1.0", "@scope/lib.math": "workspace:*" },
        peerDependencies: { react: "^19.2.7" },
      },
      { component: component(), resolveVersion }
    );

    expect(serializeProjectedComponentConfig(first)).toEqual(
      serializeProjectedComponentConfig(second)
    );
  });

  it("serializes as indented JSON ending in a newline", () => {
    const bytes = serializeProjectedComponentConfig(
      projectComponentConfig({}, { component: component(), resolveVersion })
    );
    const text = Buffer.from(bytes).toString("utf8");

    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({ env: { packageName: "demo-env-node", version: "0.0.0" } });
  });
});

function component(overrides: Partial<WorkspaceComponent> = {}): WorkspaceComponent {
  return {
    id: "ui/button",
    path: "components/ui/button",
    rootDir: "/workspace/components/ui/button",
    packageName: "@scope/ui.button",
    kind: "component",
    env: { packageName: "demo-env-node", version: "0.0.0" },
    version: undefined,
    mainFile: "/workspace/components/ui/button/index.ts",
    mainFileRelative: "index.ts",
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    internalDependencyPackageNames: [],
    internalEnvPackageName: undefined,
    ...overrides,
  };
}
