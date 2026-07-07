import { parseCliArguments } from "bit-lite-context";
import { describe, expect, it, vi } from "vitest";
import { testService } from "./index.js";
import type { ComponentRuntime, WorkspaceRuntime } from "bit-lite-context";

const components: ComponentRuntime[] = [
  {
    id: "components/demo/button",
    rootDir: "/workspace/components/demo/button",
    envName: "demo",
  },
  {
    id: "components/react/card",
    rootDir: "/workspace/components/react/card",
    envName: "react",
  },
];

const workspaceRuntime: WorkspaceRuntime = {
  workspaceRoot: "/workspace",
  config: {
    envs: {
      demo: {
        name: "demo",
        services: {
          test: {
            vendor: "bit-lite-vendors/sample/test-x",
            config: {
              label: "demo test",
              shard: "unit",
              retries: 1,
              coverage: true,
            },
          },
        },
      },
      react: {
        name: "react",
        services: {
          test: {
            vendor: "bit-lite-vendors/sample/test-y",
            config: {
              label: "react test",
              shard: "browser",
              retries: 2,
              coverage: false,
            },
          },
        },
      },
    },
    components: {
      "components/demo/button": "demo",
      "components/react/card": "react",
    },
  },
  envs: {
    demo: {
      name: "demo",
      services: {
        test: {
          vendor: "bit-lite-vendors/sample/test-x",
          config: {
            label: "demo test",
            shard: "unit",
            retries: 1,
            coverage: true,
          },
        },
      },
    },
    react: {
      name: "react",
      services: {
        test: {
          vendor: "bit-lite-vendors/sample/test-y",
          config: {
            label: "react test",
            shard: "browser",
            retries: 2,
            coverage: false,
          },
        },
      },
    },
  },
  components,
  groups: [
    {
      envName: "demo",
      env: {
        name: "demo",
        services: {
          test: {
            vendor: "bit-lite-vendors/sample/test-x",
            config: {
              label: "demo test",
              shard: "unit",
              retries: 1,
              coverage: true,
            },
          },
        },
      },
      components: [{ id: "components/demo/button", rootDir: "/workspace/components/demo/button" }],
    },
    {
      envName: "react",
      env: {
        name: "react",
        services: {
          test: {
            vendor: "bit-lite-vendors/sample/test-y",
            config: {
              label: "react test",
              shard: "browser",
              retries: 2,
              coverage: false,
            },
          },
        },
      },
      components: [{ id: "components/react/card", rootDir: "/workspace/components/react/card" }],
    },
  ],
};

describe("testService", () => {
  it("runs the test service once by default", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await expect(testService.run(createInput([]))).resolves.toBeUndefined();

      expect(log.mock.calls.map(([message]) => message)).toEqual([
        "Test results:",
        "- Test X (demo): 2/2 passed",
        "- Test Y (react): 3/3 passed",
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it("passes watch args through to the test service vendors", async () => {
    await expect(testService.run(createInput(["--watch"]))).resolves.toBeUndefined();
  });

  it("skips component groups without a configured test vendor", async () => {
    const plainComponent = {
      id: "components/plain/card",
      rootDir: "/workspace/components/plain/card",
    };
    const noVendorComponent = {
      id: "components/no-vendor/card",
      rootDir: "/workspace/components/no-vendor/card",
    };
    const context: WorkspaceRuntime = {
      ...workspaceRuntime,
      components: [
        ...workspaceRuntime.components,
        { ...plainComponent, envName: "plain" },
        { ...noVendorComponent, envName: "no-vendor" },
      ],
      groups: [
        workspaceRuntime.groups[0]!,
        {
          envName: "plain",
          env: {
            name: "plain",
            services: {},
          },
          components: [plainComponent],
        },
        {
          envName: "no-vendor",
          env: {
            name: "no-vendor",
            services: {
              test: {
                config: {
                  label: "missing vendor",
                },
              },
            },
          },
          components: [noVendorComponent],
        },
      ],
    };

    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await testService.run({
        components: context.components.map(({ id, rootDir }) => ({ id, rootDir })),
        args: parseCliArguments([]),
        context,
      });

      expect(log.mock.calls.map(([message]) => message)).toEqual(["Test results:", "- Test X (demo): 2/2 passed"]);
    } finally {
      log.mockRestore();
    }
  });
});

function createInput(rawArgs: string[]) {
  return {
    components: components.map(({ id, rootDir }) => ({ id, rootDir })),
    args: parseCliArguments(rawArgs),
    context: workspaceRuntime,
  };
}
