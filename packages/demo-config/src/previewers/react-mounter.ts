import { createElement, isValidElement, type ComponentType, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

type PreviewMounterContext = {
  componentId: string;
  compositionId: string;
};

export default function mountReactComposition(
  composition: unknown,
  root: HTMLElement,
  _context: PreviewMounterContext
) {
  const reactRoot = createRoot(root);
  reactRoot.render(toReactElement(composition));
  return () => reactRoot.unmount();
}

function toReactElement(composition: unknown): ReactElement {
  if (isValidElement(composition)) return composition;
  if (typeof composition === "function") return createElement(composition as ComponentType);
  if (isRecord(composition) && typeof composition.component === "function") {
    return createElement(composition.component as ComponentType, isRecord(composition.props) ? composition.props : {});
  }
  return createElement("pre", undefined, JSON.stringify(composition, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
