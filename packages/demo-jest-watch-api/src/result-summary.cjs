function summarizeAggregatedResult(results) {
  return {
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

function computeSuccess(results) {
  return (
    results.numFailedTests === 0 &&
    results.numRuntimeErrorTestSuites === 0 &&
    results.snapshot?.failure !== true &&
    results.wasInterrupted !== true
  );
}

module.exports = {
  summarizeAggregatedResult,
};
