export type PreviewHashRoute =
  | { kind: "overview"; componentId: string }
  | { kind: "docs"; componentId: string }
  | { kind: "composition"; componentId: string; compositionId: string }
  | { kind: "invalid"; reason: string; componentId?: string };

export function parsePreviewHash(hash: string): PreviewHashRoute {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const questionIndex = fragment.indexOf("?");
  const encodedComponentId = questionIndex === -1 ? fragment : fragment.slice(0, questionIndex);
  if (encodedComponentId.length === 0) return { kind: "invalid", reason: "A component ID is required." };

  let componentId: string;
  try {
    componentId = decodeURIComponent(encodedComponentId);
  } catch {
    return { kind: "invalid", reason: "The component ID is not valid percent-encoding." };
  }

  const search = questionIndex === -1 ? "" : fragment.slice(questionIndex + 1);
  const params = new URLSearchParams(search);
  const preview = params.get("preview");
  if (preview === null || preview === "overview") return { kind: "overview", componentId };
  if (preview === "docs") return { kind: "docs", componentId };
  if (preview !== "compositions") {
    return { kind: "invalid", componentId, reason: `Unknown preview surface: ${preview}` };
  }

  const compositionId = params.get("name");
  if (!compositionId) {
    return { kind: "invalid", componentId, reason: "A composition name is required." };
  }
  return { kind: "composition", componentId, compositionId };
}

export function formatOverviewRoute(componentId: string, explicit = false) {
  const component = encodeURIComponent(componentId);
  return explicit ? `#${component}?preview=overview` : `#${component}`;
}

export function formatDocsRoute(componentId: string) {
  return `#${encodeURIComponent(componentId)}?preview=docs`;
}

export function formatCompositionRoute(componentId: string, compositionId: string) {
  const component = encodeURIComponent(componentId);
  const name = encodeURIComponent(compositionId);
  return `#${component}?preview=compositions&name=${name}`;
}
