import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServiceTask } from "../../../runtime.js";
import { registerPreviewVendorCloser } from "../runtime.js";
import type { PreviewEntry, PreviewVendor } from "../types.js";

export const staticPreviewVendor: PreviewVendor = {
  name: "static",
  run(input, context) {
    return createServiceTask(async ({ emit }) => {
      const server = createServer((req, res) => {
        void handleRequest(req, res, input.entries);
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(input.port, input.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      registerPreviewVendorCloser(
        () =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          })
      );
      const url = `http://${input.host}:${input.port}${input.base}`;
      emit("ready", { url, port: input.port, base: input.base });
      return {
        ok: true,
        message: `static preview ${context?.envName} running at ${url}`,
        url,
        port: input.port,
        base: input.base,
      };
    });
  },
};

export default staticPreviewVendor;

async function handleRequest(req: IncomingMessage, res: ServerResponse, entries: PreviewEntry[]) {
  if (!req.url) {
    sendText(res, 404, "not found");
    return;
  }
  const url = new URL(req.url, "http://127.0.0.1");
  const componentId = url.searchParams.get("component") ?? entries[0]?.id;
  const view = url.searchParams.get("view") ?? "preview";
  const entry = entries.find((candidate) => candidate.id === componentId) ?? entries[0];
  if (!entry) {
    sendHtml(res, page("No previews", "<p>No component preview files were found.</p>"));
    return;
  }

  if (view === "docs") {
    sendHtml(res, page(`${entry.id} docs`, await renderFile(entry.docsFile, "No docs file found.")));
    return;
  }
  if (view === "source") {
    sendHtml(res, page(`${entry.id} source`, await renderCode(entry.sourceFile, "No source file found.")));
    return;
  }

  const preview = await renderCode(entry.previewFile, "No preview file found.");
  sendHtml(
    res,
    page(
      `${entry.id} preview`,
      `<section class="demo"><h1>${escapeHtml(entry.id)}</h1><p>Static preview vendor</p>${preview}</section>`
    )
  );
}

async function renderFile(filePath: string | undefined, fallback: string) {
  if (!filePath) return `<p>${escapeHtml(fallback)}</p>`;
  const content = await readText(filePath, fallback);
  return `<article class="docs">${renderMarkdown(content)}</article>`;
}

async function renderCode(filePath: string | undefined, fallback: string) {
  if (!filePath) return `<p>${escapeHtml(fallback)}</p>`;
  const content = await readText(filePath, fallback);
  return `<pre><code>${escapeHtml(content)}</code></pre>`;
}

async function readText(filePath: string, fallback: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function page(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #20242b;
        background: #ffffff;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        min-height: 100vh;
        padding: 32px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }
      p {
        color: #596273;
      }
      pre {
        overflow: auto;
        margin: 18px 0 0;
        border: 1px solid #d8dee8;
        border-radius: 8px;
        padding: 16px;
        background: #f7f8fb;
        line-height: 1.5;
      }
      .docs {
        max-width: 760px;
        line-height: 1.65;
      }
      .demo {
        display: grid;
        gap: 10px;
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}

function renderMarkdown(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        const level = heading[1]?.length ?? 1;
        const text = heading[2] ?? "";
        return `<h${level}>${escapeHtml(text)}</h${level}>`;
      }
      if (!line.trim()) return "";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n");
}

function sendHtml(res: ServerResponse, body: string) {
  res.writeHead(200, { "content-type": "text/html; charset=utf8" });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf8" });
  res.end(body);
}

function escapeHtml(value: string | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
