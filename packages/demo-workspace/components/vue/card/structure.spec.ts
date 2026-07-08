import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/vue";
import Card from "./index.vue";

describe("Card.vue interactions", () => {
  it("increments the click counter", async () => {
    render(Card, {
      props: {
        title: "Counter card",
        body: "Click it.",
      },
    });

    const button = screen.getByRole("button", { name: "Clicked 0 times" });
    await fireEvent.click(button);

    assert.equal(screen.getByRole("button", { name: "Clicked 1 times" }).textContent, "Clicked 1 times");
  });
});
