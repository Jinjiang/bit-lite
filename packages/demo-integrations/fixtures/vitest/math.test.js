import { expect, test } from "vitest";
import { multiply } from "./math.js";

// The console.log inside this test is intentional: it proves test-level output
// is captured under the Vitest worker instead of the parent process terminal.
test("multiplies two numbers", () => {
  console.log("[vitest test] this console.log is owned by the Vitest worker");
  expect(multiply(4, 5)).toBe(20);
});
