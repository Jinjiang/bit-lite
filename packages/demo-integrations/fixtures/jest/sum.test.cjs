const { sum } = require("./sum.cjs");

// The console.log inside this test is intentional: it proves test-level output
// is captured under the Jest worker instead of the parent process terminal.
test("adds two numbers", () => {
  console.log("[jest test] this console.log is owned by the Jest worker");
  expect(sum(2, 3)).toBe(5);
});
