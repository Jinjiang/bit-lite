import { describe, expect, it } from "vitest";
import { renderCard } from "./index.js";

describe("renderCard", () => {
  it("renders card content", () => {
    const html = renderCard({ title: "Hello", body: "World" });
    expect(html).toContain("Hello");
    expect(html).toContain("World");
  });
});
