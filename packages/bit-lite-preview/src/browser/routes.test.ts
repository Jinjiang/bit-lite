import { describe, expect, it } from "vitest";
import {
  formatCompositionRoute,
  formatDocsRoute,
  formatOverviewRoute,
  parsePreviewHash,
} from "../routes.js";

describe("preview hash routes", () => {
  it("defaults a component hash to overview", () => {
    expect(parsePreviewHash("#ui%2Fbutton")).toEqual({ kind: "overview", componentId: "ui/button" });
    expect(parsePreviewHash("#ui%2Fbutton?preview=overview")).toEqual({
      kind: "overview",
      componentId: "ui/button",
    });
  });

  it("parses docs and named demos", () => {
    expect(parsePreviewHash("#ui%2Fbutton?preview=docs")).toEqual({ kind: "docs", componentId: "ui/button" });
    expect(parsePreviewHash("#ui%2Fbutton?preview=compositions&name=primary%2FMySecondDemo")).toEqual({
      kind: "composition",
      componentId: "ui/button",
      compositionId: "primary/MySecondDemo",
    });
  });

  it("rejects invalid routes", () => {
    expect(parsePreviewHash("")).toMatchObject({ kind: "invalid" });
    expect(parsePreviewHash("#ui%2Fbutton?preview=compositions")).toMatchObject({
      kind: "invalid",
      componentId: "ui/button",
    });
    expect(parsePreviewHash("#ui%2Fbutton?preview=other")).toMatchObject({ kind: "invalid" });
  });

  it("formats encoded routes", () => {
    expect(formatOverviewRoute("ui/button")).toBe("#ui%2Fbutton");
    expect(formatOverviewRoute("ui/button", true)).toBe("#ui%2Fbutton?preview=overview");
    expect(formatDocsRoute("ui/button")).toBe("#ui%2Fbutton?preview=docs");
    expect(formatCompositionRoute("ui/button", "primary/MySecondDemo")).toBe(
      "#ui%2Fbutton?preview=compositions&name=primary%2FMySecondDemo"
    );
  });
});
