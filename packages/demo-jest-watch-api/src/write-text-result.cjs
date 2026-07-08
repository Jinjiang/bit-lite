const fs = require("node:fs");
const path = require("node:path");

function appendTextResult(outputFile, results) {
  const resolvedOutputFile = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(resolvedOutputFile), { recursive: true });
  fs.appendFileSync(resolvedOutputFile, `${formatTextResult(results)}\n---\n`);
}

function formatTextResult(results) {
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
  appendTextResult,
  formatTextResult,
};
