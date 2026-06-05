import { describe, expect, it } from "vitest";
import { renderButton } from "./index.js";

describe("renderButton", () => {
  it("renders a simple button string", () => {
    expect(renderButton({ label: "Save" })).toBe('<button data-weight="2">Save</button>');
  });
});
