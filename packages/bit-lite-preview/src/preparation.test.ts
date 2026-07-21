import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  derivePreviewCompositionName,
  discoverPreviewComponents,
  preparePreviewEnv,
  resolvePreviewServiceConfig,
} from "./preparation.js";

describe("preview preparation", () => {
  it("discovers selected components and files deterministically", async () => {
    const workspaceRoot = await createWorkspace();
    const alphaRoot = await createComponent(workspaceRoot, "alpha", {
      "zeta.demo.tsx": "export const XMLCard = {}; export type Hidden = string;",
      "alpha.docs.mdx": "---\ntitle: Alpha docs\n---\n# Ignored heading",
      "first.demo.tsx": "export default {}; export const MySecondDemo = {};",
      "notes.txt": "not preview content",
    });
    const zetaRoot = await createComponent(workspaceRoot, "zeta", {
      "zeta.docs.md": "# Zeta documentation",
    });

    const result = await discoverPreviewComponents([
      { id: "scope/zeta", rootDir: zetaRoot, packageName: "@scope/zeta" },
      { id: "scope/alpha", rootDir: alphaRoot, packageName: "@scope/alpha" },
    ]);

    expect(result.map((component) => component.component.id)).toEqual(["scope/alpha", "scope/zeta"]);
    expect(result[0]?.docs).toMatchObject({ title: "Alpha docs", route: "#scope%2Falpha?preview=docs" });
    expect(result[0]?.compositions).toEqual([
      {
        id: "first/default",
        exportName: "default",
        name: "Default",
        filePath: path.join(alphaRoot, "first.demo.tsx"),
        route: "#scope%2Falpha?preview=compositions&name=first%2Fdefault",
      },
      {
        id: "first/MySecondDemo",
        exportName: "MySecondDemo",
        name: "My Second Demo",
        filePath: path.join(alphaRoot, "first.demo.tsx"),
        route: "#scope%2Falpha?preview=compositions&name=first%2FMySecondDemo",
      },
      {
        id: "zeta/XMLCard",
        exportName: "XMLCard",
        name: "XML Card",
        filePath: path.join(alphaRoot, "zeta.demo.tsx"),
        route: "#scope%2Falpha?preview=compositions&name=zeta%2FXMLCard",
      },
    ]);
    expect(result[1]?.docs?.title).toBe("Zeta documentation");
  });

  it("discovers runtime export forms in source order and derives readable names", async () => {
    const workspaceRoot = await createWorkspace();
    const componentRoot = await createComponent(workspaceRoot, "exports", {
      "primary.demo.ts": [
        "interface LocalType {}",
        "export type PublicType = string;",
        "export { LocalType };",
        "const separated_demo = {};",
        "export default {};",
        "export const mySecondDemo = {};",
        "export function XMLCard() {}",
        "export const demo2State = {};",
        "export { separated_demo };",
      ].join("\n"),
      "secondary.demo.ts": "export const mySecondDemo = {};",
    });

    const [component] = await discoverPreviewComponents([
      { id: "scope/exports", rootDir: componentRoot, packageName: "@scope/exports" },
    ]);

    expect(component?.compositions.map(({ id, exportName, name }) => ({ id, exportName, name }))).toEqual([
      { id: "primary/default", exportName: "default", name: "Default" },
      { id: "primary/mySecondDemo", exportName: "mySecondDemo", name: "My Second Demo" },
      { id: "primary/XMLCard", exportName: "XMLCard", name: "XML Card" },
      { id: "primary/demo2State", exportName: "demo2State", name: "Demo2 State" },
      { id: "primary/separated_demo", exportName: "separated_demo", name: "Separated demo" },
      { id: "secondary/mySecondDemo", exportName: "mySecondDemo", name: "My Second Demo" },
    ]);
    expect(derivePreviewCompositionName("PascalCaseDemo")).toBe("Pascal Case Demo");
  });

  it("rejects unresolved runtime star exports with file context", async () => {
    const workspaceRoot = await createWorkspace();
    const componentRoot = await createComponent(workspaceRoot, "star", {
      "primary.demo.ts": 'export * from "./other.js";\n',
    });

    await expect(
      discoverPreviewComponents([{ id: "scope/star", rootDir: componentRoot, packageName: "@scope/star" }])
    ).rejects.toThrow(
      `demo file ${path.join(componentRoot, "primary.demo.ts")} uses unsupported unresolved export *`
    );
  });

  it("resolves config modules before generating one safe entry and HTML document", async () => {
    const workspaceRoot = await createWorkspace();
    const componentRoot = await createComponent(workspaceRoot, "quoted", {
      "quoted.docs.mdx": "# Docs",
      "primary.demo.tsx": "export default {}; export const MySecondDemo = {};",
    });
    const configFile = await createFile(workspaceRoot, "config/vite.ts", "export default {};");
    const mounter = await createFile(workspaceRoot, "config/mounter.ts", "export default () => {};\n");
    const docsTemplate = await createFile(workspaceRoot, "config/docs-template.tsx", "export default () => null;\n");
    const browserModulePath = await createFile(workspaceRoot, "runtime/browser.ts", "export const startPreview = () => ({});\n");

    const prepared = await preparePreviewEnv({
      env: selectedEnv("react env"),
      components: [{ id: 'scope/"quoted"', rootDir: componentRoot, packageName: "@scope/quoted" }],
      config: {
        configFile: "./config/vite.ts",
        mounter: "./config/mounter.ts",
        docsTemplate: "./config/docs-template.tsx",
      },
      workspaceRoot,
      server: {
        host: "127.0.0.1",
        preferredPort: 6000,
        fallbackStartPort: 6001,
        basePath: "/env/react%20env/",
        proxyOrigin: "http://127.0.0.1:4000",
      },
      browserModulePath,
    });

    const source = await readFile(prepared.runtime.prepared.entryFile, "utf8");
    const html = await readFile(prepared.runtime.prepared.htmlFile, "utf8");
    expect(prepared.config).toMatchObject({ configFile, mounter, docsTemplate });
    expect(source).toContain('component: { id: "scope/\\\"quoted\\\"" }');
    expect(source.match(/load: \(\) => import\(/g)).toHaveLength(3);
    expect(source.match(/primary\.demo\.tsx/g)).toHaveLength(2);
    expect(source).toContain('.then((module) => module["default"])');
    expect(source).toContain('.then((module) => module["MySecondDemo"])');
    expect(source).toContain('id: "primary/MySecondDemo"');
    expect(source).toContain('name: "My Second Demo"');
    expect(source).toContain("mounter: previewMounter");
    expect(source).toContain("docsTemplate: PreviewDocsTemplate");
    expect(source).not.toContain("renderOverview");
    expect(source).not.toContain("loadDocs");
    expect(source).not.toContain("loadComposition");
    expect(html).toContain('src="./__bit-lite/preview.js"');
    expect(Object.keys(prepared.runtime)).toEqual(["server", "prepared", "aliases"]);
    expect(prepared.runtime.aliases).toEqual([
      { packageName: "@scope/quoted", sourceDir: componentRoot },
    ]);
    expect(JSON.parse(JSON.stringify(prepared.runtime))).toEqual(prepared.runtime);

    const tempDir = prepared.tempDir;
    await prepared.cleanup();
    await prepared.cleanup();
    await expect(access(tempDir)).rejects.toThrow();
  });

  it("omits optional renderer imports and only requires a mounter for envs with demos", async () => {
    const workspaceRoot = await createWorkspace();
    const docsOnlyRoot = await createComponent(workspaceRoot, "docs-only", {
      "docs-only.docs.md": "# Docs only",
    });
    const withDemoRoot = await createComponent(workspaceRoot, "with-demo", {
      "primary.demo.ts": "export const Primary = {};",
    });
    await createFile(workspaceRoot, "config/vite.ts", "export default {};\n");
    const browserModulePath = await createFile(workspaceRoot, "runtime/browser.ts", "export const startPreview = () => ({});\n");
    const baseOptions = {
      env: selectedEnv("static"),
      config: { configFile: "./config/vite.ts" },
      workspaceRoot,
      server: {
        host: "127.0.0.1",
        preferredPort: 6000,
        fallbackStartPort: 6001,
        basePath: "/env/static/",
        proxyOrigin: "http://127.0.0.1:4000",
      },
      browserModulePath,
    };

    const prepared = await preparePreviewEnv({
      ...baseOptions,
      components: [{ id: "scope/docs-only", rootDir: docsOnlyRoot, packageName: "@scope/docs-only" }],
    });
    const source = await readFile(prepared.runtime.prepared.entryFile, "utf8");
    expect(source).not.toContain("previewMounter");
    expect(source).not.toContain("PreviewDocsTemplate");
    await prepared.cleanup();

    await expect(
      preparePreviewEnv({
        ...baseOptions,
        components: [{ id: "scope/with-demo", rootDir: withDemoRoot, packageName: "@scope/with-demo" }],
      })
    ).rejects.toThrow('config.mounter is required because the selected components contain demos');
  });

  it("reports unresolvable service modules with env and field context", async () => {
    const workspaceRoot = await createWorkspace();
    await expect(
      resolvePreviewServiceConfig(
        { configFile: "./missing-vite.ts" },
        workspaceRoot,
        "broken-env"
      )
    ).rejects.toThrow('preview env "broken-env" config.configFile could not be resolved: ./missing-vite.ts');
  });
});

async function createWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bit-lite-preview-prepare-"));
  await writeFile(path.join(workspaceRoot, "package.json"), '{"type":"module"}\n', "utf8");
  return workspaceRoot;
}

function selectedEnv(packageName: string) {
  return { packageName, requestedVersion: "^1.0.0", installedVersion: "1.2.0" };
}

async function createComponent(workspaceRoot: string, name: string, files: Record<string, string>) {
  const rootDir = path.join(workspaceRoot, "components", name);
  await mkdir(rootDir, { recursive: true });
  await Promise.all(
    Object.entries(files).map(([fileName, source]) => writeFile(path.join(rootDir, fileName), source, "utf8"))
  );
  return rootDir;
}

async function createFile(workspaceRoot: string, relativePath: string, source: string) {
  const filePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source, "utf8");
  return filePath;
}
