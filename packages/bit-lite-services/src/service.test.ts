import { parseCliArguments } from "bit-lite-context";
import { describe, expect, it } from "vitest";
import { runService, testService } from "./index.js";
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

describe("runService", () => {
  it("runs the test service once by default", async () => {
    const result = await runService({
      service: testService,
      input: createInput([]),
      runnerMode: "inline",
    });

    expect(result.mode).toBe("run");
    expect(result.status).toBe("success");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.vendorId).toBe("test-x");
    expect(result.results[0]?.data).toMatchObject({
      service: "test",
      vendor: "x",
      mode: "run",
      passed: 2,
      failed: 0,
      config: {
        label: "demo test",
        shard: "unit",
        retries: 1,
        coverage: true,
      },
    });
    expect(result.results[1]?.vendorId).toBe("test-y");
    expect(result.results[1]?.data).toMatchObject({
      service: "test",
      vendor: "y",
      mode: "run",
      passed: 3,
      failed: 0,
      config: {
        label: "react test",
        shard: "browser",
        retries: 2,
        coverage: false,
      },
    });
  });

  it("switches to watch mode from cli args", async () => {
    const result = await runService({
      service: testService,
      input: createInput(["--watch"]),
      runnerMode: "inline",
      terminal: {
        enabled: false,
        autoStopMs: 20,
      },
    });

    expect(result.mode).toBe("watch");
    expect(result.status).toBe("stopped");
    expect(result.results[0]?.data).toMatchObject({
      service: "test",
      vendor: "x",
      mode: "watch",
      config: {
        label: "demo test",
      },
    });
  });
});

function createInput(rawArgs: string[]) {
  return {
    components: components.map(({ id, rootDir }) => ({ id, rootDir })),
    config: {},
    args: parseCliArguments(rawArgs),
    context: workspaceRuntime,
  };
}
