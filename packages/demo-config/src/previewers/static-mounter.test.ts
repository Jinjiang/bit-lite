// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import mountStaticComposition from "./static-mounter.js";

describe("static preview mounter", () => {
  it("preserves DOM written by a composition that returns undefined", async () => {
    const root = document.createElement("div");

    await mountStaticComposition(
      (host: HTMLElement) => {
        host.innerHTML = "<strong>Rendered by the demo</strong>";
      },
      root,
      { componentId: "lib/math", compositionId: "primary/InteractiveOperands" }
    );

    expect(root.textContent).toBe("Rendered by the demo");
  });
});
