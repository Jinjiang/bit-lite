import assert from "node:assert/strict";
import { add } from "./index.js";

describe("math arithmetic", () => {
  it("adds positive numbers", () => {
    assert.equal(add(4, 6), 10);
  });

  it("adds negative numbers", () => {
    assert.equal(add(-4, -6), -10);
  });
});
