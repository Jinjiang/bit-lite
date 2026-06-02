import { describe, expect, it } from "vitest";
import { createGreeting } from "./index.js";

describe("createGreeting", () => {
  it("returns the default readiness message", () => {
    expect(createGreeting()).toBe("bit-lite: ready");
  });
});
