import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "./index.js";

describe("Button interactions", () => {
  it("calls the click handler", () => {
    let clicks = 0;
    render(<Button label="Publish" onClick={() => clicks += 1} />);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    assert.equal(clicks, 1);
  });
});
