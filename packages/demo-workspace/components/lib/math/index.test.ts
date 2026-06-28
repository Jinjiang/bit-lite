import assert from "node:assert/strict";
import { add } from "./index.js";

describe("add", () => {
  it("adds two numbers", () => {
    assert.equal(add(2, 3), 5);
  });
});
