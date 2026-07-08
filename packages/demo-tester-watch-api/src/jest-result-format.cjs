const path = require("node:path");

function createJestResult(run, results) {
  return {
    vendor: "jest",
    run,
    success: results.success,
    computedSuccess: computeSuccess(results),
    numFailedTests: results.numFailedTests,
    numPassedTests: results.numPassedTests,
    numRuntimeErrorTestSuites: results.numRuntimeErrorTestSuites,
    numTotalTests: results.numTotalTests,
    numTotalTestSuites: results.numTotalTestSuites,
    wasInterrupted: results.wasInterrupted,
    testFiles: results.testResults.map((result) => result.testFilePath),
  };
}

function formatJestTextResult(results) {
  return [
    ...formatTestFiles(results),
    formatTestSuitesSummary(results),
    formatTestsSummary(results),
    formatSnapshotsSummary(results),
    formatTimeSummary(results),
  ]
    .filter(Boolean)
    .join("\n");
}

function computeSuccess(results) {
  return (
    results.numFailedTests === 0 &&
    results.numRuntimeErrorTestSuites === 0 &&
    results.snapshot?.failure !== true &&
    results.wasInterrupted !== true
  );
}

function formatTestFiles(results) {
  return results.testResults.flatMap((testResult) => {
    const status = testResult.numFailingTests > 0 || testResult.testExecError ? "FAIL" : "PASS";
    const lines = [`${status} ${relativePath(testResult.testFilePath)}`];

    if (testResult.failureMessage) {
      lines.push("", testResult.failureMessage.trimEnd(), "");
    }

    return lines;
  });
}

function formatTestSuitesSummary(results) {
  return `Test Suites: ${formatCounts([
    ["failed", results.numFailedTestSuites],
    ["passed", results.numPassedTestSuites],
    ["total", results.numTotalTestSuites],
  ])}`;
}

function formatTestsSummary(results) {
  return `Tests:       ${formatCounts([
    ["failed", results.numFailedTests],
    ["passed", results.numPassedTests],
    ["total", results.numTotalTests],
  ])}`;
}

function formatSnapshotsSummary(results) {
  return `Snapshots:   ${results.snapshot?.total ?? 0} total`;
}

function formatTimeSummary(results) {
  const elapsedSeconds = Math.max(0, (Date.now() - results.startTime) / 1000);
  return `Time:        ${elapsedSeconds.toFixed(3)} s`;
}

function formatCounts(counts) {
  return counts
    .filter(([label, count]) => label === "total" || count > 0)
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
}

function relativePath(filePath) {
  return path.relative(process.cwd(), filePath) || filePath;
}

module.exports = {
  createJestResult,
  formatJestTextResult,
};
