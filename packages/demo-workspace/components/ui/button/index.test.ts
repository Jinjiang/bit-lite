import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./index.js";

describe("Button", () => {
  it("renders the React button component", () => {
    const html = renderToStaticMarkup(createElement(Button, { label: "Save", count: 2 }));
    assert.match(html, /<button/);
    assert.match(html, /data-weight="2"/);
    assert.match(html, /Save: 2/);
  });
});
