import type { ComponentType, ReactNode } from "react";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export type PreviewPackageAlias = {
  packageName: string;
  sourceDir: string;
};

export type PreviewPreparedRuntime = JsonObject & {
  server: {
    host: string;
    preferredPort: number;
    fallbackStartPort: number;
    basePath: string;
    proxyOrigin: string;
  };
  prepared: {
    entryFile: string;
    htmlFile: string;
  };
  aliases: PreviewPackageAlias[];
};

export type PreviewComponentManifest = {
  id: string;
};

export type PreviewDocsModule = {
  default: ComponentType;
  frontmatter?: Record<string, unknown>;
  [exportName: string]: unknown;
};

export type PreviewComposition = unknown;

export type PreviewBrowserDocs = {
  title?: string;
  route: string;
  load: () => Promise<PreviewDocsModule>;
};

export type PreviewBrowserComposition = {
  id: string;
  exportName: string;
  name: string;
  route: string;
  load: () => Promise<PreviewComposition>;
};

export type PreviewBrowserComponent = {
  component: PreviewComponentManifest;
  docs?: PreviewBrowserDocs;
  compositions: PreviewBrowserComposition[];
};

export type PreviewDocsTemplateProps = {
  docs: PreviewDocsModule;
};

export type PreviewDocsTemplate = ComponentType<PreviewDocsTemplateProps>;

export type PreviewMounterContext = {
  componentId: string;
  compositionId: string;
};

export type PreviewMounterCleanup = () => void | Promise<void>;

export type PreviewMounter = (
  composition: PreviewComposition,
  root: HTMLElement,
  context: PreviewMounterContext
) => void | PreviewMounterCleanup | Promise<void | PreviewMounterCleanup>;

export type PreviewOverviewProps = {
  component: PreviewComponentManifest;
  docs?: {
    title?: string;
    route: string;
  };
  compositions: Array<{
    id: string;
    exportName: string;
    name: string;
    route: string;
  }>;
};

export type PreviewOverviewRenderer = (props: PreviewOverviewProps) => ReactNode;

export type StartPreviewOptions = {
  components: PreviewBrowserComponent[];
  mounter?: PreviewMounter;
  docsTemplate?: PreviewDocsTemplate;
  renderOverview?: PreviewOverviewRenderer;
};

export type PreviewRuntimeController = {
  refresh(): Promise<void>;
  stop(): Promise<void>;
};
