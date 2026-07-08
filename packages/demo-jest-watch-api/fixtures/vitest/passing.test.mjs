import { expect, test } from "vitest";

test("multiplies numbers", () => {
  expect(2 * 2).toBe(6);
});

test("matches a string", () => {
  expect("vitest watch mode").toContain("watch");
});
