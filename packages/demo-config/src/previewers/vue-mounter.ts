import { createApp, h, type Component } from "vue";
import { isRecord } from "bit-lite-utils";

type PreviewMounterContext = {
  componentId: string;
  compositionId: string;
};

export default function mountVueComposition(
  composition: unknown,
  root: HTMLElement,
  _context: PreviewMounterContext
) {
  const app = createApp({
    render() {
      const { component, props } = readVueComposition(composition);
      return h(component, props);
    },
  });
  app.mount(root);
  return () => app.unmount();
}

function readVueComposition(composition: unknown): { component: Component; props: Record<string, unknown> } {
  if (isRecord(composition) && composition.component !== undefined) {
    return {
      component: composition.component as Component,
      props: isRecord(composition.props) ? composition.props : {},
    };
  }
  return { component: composition as Component, props: {} };
}
