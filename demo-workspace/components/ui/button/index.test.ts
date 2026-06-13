import assert from "node:assert/strict";
import { renderButton } from "./index.js";

describe("renderButton", () => {
  it("renders a simple button string", () => {
    assert.equal(renderButton({ label: "Save" }), '<button data-weight="2">Save</button>');
  });
});
