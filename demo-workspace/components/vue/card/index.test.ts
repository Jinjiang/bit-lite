import assert from "node:assert/strict";
import { renderCard } from "./index.js";

describe("renderCard", () => {
  it("renders card content", () => {
    const html = renderCard({ title: "Hello", body: "World" });
    assert.match(html, /Hello/);
    assert.match(html, /World/);
  });
});
