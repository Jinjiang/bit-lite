import assert from "node:assert/strict";
import { render, screen } from "@testing-library/vue";
import Card from "./index.vue";

describe("Card.vue", () => {
  it("renders title and body content", () => {
    render(Card, {
      props: {
        title: "Release plan",
        body: "Ship the real Vue demo.",
      },
    });

    assert.equal(screen.getByRole("heading", { name: "Release plan" }).textContent, "Release plan");
    assert.equal(screen.getByText("Ship the real Vue demo.").textContent, "Ship the real Vue demo.");
  });
});
