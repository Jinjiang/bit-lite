import { readFileSync } from "node:fs";
import { sendHtml, sendJson, sendText } from "bit-lite-proxy";
import type { ProxyRoute } from "bit-lite-proxy";
import type { SelectedEnvIdentity } from "bit-lite-context";
import type { TestComponentResult, TestWatchContribution } from "./test.js";

const testPageHtml = readFileSync(new URL("../assets/start-test.html", import.meta.url), "utf8");
const structuredNotice = "This is the latest observed update for this component, not a guaranteed complete test snapshot.";

export type ComponentTestSnapshot = {
  componentId: string;
  env: SelectedEnvIdentity;
  task: {
    id: string;
    vendor: string;
    status: string;
  };
  result: {
    observedAt: string;
    run: number;
    files: string[];
    stats: TestComponentResult["stats"];
    durationMs: number;
    errors: string[];
  } | null;
  terminal: {
    scope: "env";
    text: string;
  };
  notices: string[];
};

export function createTestResultRoutes(contribution: TestWatchContribution): ProxyRoute[] {
  return [
    {
      id: "test:page",
      matches: (url) => url.pathname === "/tests",
      handleHttp(request, response, { url }) {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          sendText(response, 405, "Method not allowed");
          return;
        }
        const componentId = url.searchParams.get("component");
        if (!componentId) {
          sendText(response, 400, "A component query parameter is required");
          return;
        }
        if (!readComponentTestSnapshot(contribution, componentId)) {
          sendText(response, 404, `No configured test task contains component "${componentId}"`);
          return;
        }
        sendHtml(response, 200, testPageHtml);
      },
    },
    {
      id: "test:result",
      matches: (url) => url.pathname === "/__bit-lite/test-results.json",
      handleHttp(request, response, { url }) {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          sendText(response, 405, "Method not allowed");
          return;
        }
        const componentId = url.searchParams.get("component");
        if (!componentId) {
          sendJson(response, { error: "A component query parameter is required" }, 400);
          return;
        }
        const snapshot = readComponentTestSnapshot(contribution, componentId);
        if (!snapshot) {
          sendJson(response, { error: `No configured test task contains component "${componentId}"` }, 404);
          return;
        }
        sendJson(response, snapshot);
      },
    },
  ];
}

export function readComponentTestSnapshot(
  contribution: TestWatchContribution,
  componentId: string
): ComponentTestSnapshot | undefined {
  const binding = contribution.bindings.find((candidate) => candidate.componentIds.includes(componentId));
  if (!binding) return undefined;

  let latest:
    | {
        observedAt: string;
        run: number;
        component: TestComponentResult;
      }
    | undefined;
  const entries = contribution.resultStore.entries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.taskId !== binding.task.id) continue;
    const component = entry.json.componentResults.find((candidate) => candidate.componentId === componentId);
    if (!component) continue;
    latest = { observedAt: entry.observedAt, run: entry.json.run, component };
    break;
  }

  const env = binding.task.context.env;
  const envNotice = `Terminal output is env-level for "${env.packageName}" and may include other components in the same environment.`;
  return {
    componentId,
    env,
    task: {
      id: binding.task.id,
      vendor: binding.task.vendor.id,
      status: binding.task.status,
    },
    result: latest
      ? {
          observedAt: latest.observedAt,
          run: latest.run,
          files: [...latest.component.files],
          stats: { ...latest.component.stats },
          durationMs: latest.component.durationMs,
          errors: [...latest.component.errors],
        }
      : null,
    terminal: {
      scope: "env",
      text: serializeTerminalOutput(binding.task.rawOutput.entries()),
    },
    notices: [structuredNotice, envNotice, "Terminal text is the latest output currently retained by the task buffer."],
  };
}

export function serializeTerminalOutput(entries: ReadonlyArray<{ chunk: Buffer }>) {
  const text = Buffer.concat(entries.map((entry) => entry.chunk)).toString("utf8");
  return stripTerminalControls(text);
}

function stripTerminalControls(value: string) {
  return value
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/\r(?!\n)/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g, "");
}
