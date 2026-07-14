type PreviewMounterContext = {
  componentId: string;
  compositionId: string;
};

type StaticComposition = (
  root: HTMLElement,
  context: PreviewMounterContext
) => void | string | Node | (() => void) | Promise<void | string | Node | (() => void)>;

export default async function mountStaticComposition(
  composition: unknown,
  root: HTMLElement,
  context: PreviewMounterContext
) {
  if (typeof composition === "function") {
    const result = await (composition as StaticComposition)(root, context);
    return applyResult(root, result);
  }
  return applyResult(root, composition);
}

function applyResult(root: HTMLElement, result: unknown) {
  if (result === undefined) return undefined;
  if (typeof result === "function") return result as () => void;
  if (typeof result === "string") {
    root.innerHTML = result;
    return undefined;
  }
  if (result instanceof Node) {
    root.replaceChildren(result);
    return undefined;
  }
  root.textContent = JSON.stringify(result, null, 2);
  return undefined;
}
