import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import { Button } from "./index.js";

describe("Button", () => {
  it("renders the React button component", () => {
    render(<Button label="Save" count={2} />);

    const button = screen.getByRole("button", { name: "Save: 2" });
    assert.equal(button.getAttribute("data-weight"), "2");
  });
});
