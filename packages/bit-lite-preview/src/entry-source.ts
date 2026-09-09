import { readFileSync } from "node:fs";
import path from "node:path";
import { toPosixPath } from "bit-lite-utils/node";
import type { PreparedPreviewComponent } from "./component-discovery.js";
import type { ResolvedPreviewServiceConfig } from "./preparation.js";

const previewHtmlTemplate = readFileSync(
  new URL("./assets/preview-entry.html", import.meta.url),
  "utf8"
);

/**
 * What: generates the module a preview dev server bundles.
 *
 * Why generated source rather than data the runtime reads: every docs page and
 * composition has to become a real `import()` for the bundler to see it, code
 * split it, and replace it on a hot update. A manifest of file paths would be
 * opaque to the bundler and nothing would reload.
 */
export function createPreviewEntrySource(options: {
  components: PreparedPreviewComponent[];
  config: ResolvedPreviewServiceConfig;
  entryFile: string;
  browserModulePath: string;
}) {
  const entryDir = path.dirname(options.entryFile);
  const { mounter, docsTemplate } = options.config;

  return [
    `import { startPreview } from ${moduleSpecifier(entryDir, options.browserModulePath)};`,
    ...(mounter ? [`import previewMounter from ${moduleSpecifier(entryDir, mounter)};`] : []),
    ...(docsTemplate
      ? [`import PreviewDocsTemplate from ${moduleSpecifier(entryDir, docsTemplate)};`]
      : []),
    "",
    "const components = [",
    options.components
      .map((component) => createBrowserComponentSource(component, entryDir))
      .join(",\n"),
    "];",
    "",
    "const previewController = startPreview({",
    "  components,",
    ...(mounter ? ["  mounter: previewMounter,"] : []),
    ...(docsTemplate ? ["  docsTemplate: PreviewDocsTemplate,"] : []),
    "});",
    "",
    // Both bundlers Bit Lite ships a vendor for; whichever is running, the one
    // that is not simply leaves its block inert.
    "if (import.meta.hot) {",
    "  import.meta.hot.accept(() => previewController.refresh());",
    '  import.meta.hot.on("vite:beforeUpdate", () => setTimeout(() => previewController.refresh(), 0));',
    "  import.meta.hot.dispose(() => previewController.stop());",
    "}",
    'if (typeof module !== "undefined" && module.hot) {',
    "  module.hot.accept();",
    "  module.hot.addStatusHandler?.((status) => {",
    '    if (status === "idle") void previewController.refresh();',
    "  });",
    "  module.hot.dispose(() => previewController.stop());",
    "}",
    "",
  ].join("\n");
}

export function createPreviewHtml() {
  return previewHtmlTemplate.replace("{{PREVIEW_SCRIPT_PATH}}", "./__bit-lite/preview.js");
}

function createBrowserComponentSource(component: PreparedPreviewComponent, entryDir: string) {
  const docsSource = component.docs
    ? [
        "    docs: {",
        `      title: ${literal(component.docs.title)},`,
        `      route: ${literal(component.docs.route)},`,
        `      load: () => import(${moduleSpecifier(entryDir, component.docs.filePath)}),`,
        "    },",
      ]
    : [];
  const compositionSources = component.compositions.map((composition) =>
    [
      "      {",
      `        id: ${literal(composition.id)},`,
      `        exportName: ${literal(composition.exportName)},`,
      `        name: ${literal(composition.name)},`,
      `        route: ${literal(composition.route)},`,
      `        load: () => import(${moduleSpecifier(entryDir, composition.filePath)})`,
      `          .then((module) => module[${literal(composition.exportName)}]),`,
      "      },",
    ].join("\n")
  );

  return [
    "  {",
    `    component: { id: ${literal(component.component.id)} },`,
    ...docsSource,
    "    compositions: [",
    ...compositionSources,
    "    ],",
    "  }",
  ].join("\n");
}

/** A path written as a relative import the generated entry can resolve. */
function moduleSpecifier(fromDir: string, target: string) {
  const relative = toPosixPath(path.relative(fromDir, target));
  return literal(relative.startsWith(".") ? relative : `./${relative}`);
}

function literal(value: string) {
  return JSON.stringify(value);
}
