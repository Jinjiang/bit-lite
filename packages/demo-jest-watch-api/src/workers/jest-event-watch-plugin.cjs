const { parentPort } = require("node:worker_threads");
const { summarizeAggregatedResult } = require("../result-summary.cjs");
const { formatTextResult } = require("../write-text-result.cjs");

let run = 0;

class JestEventWatchPlugin {
  apply(jestHooks) {
    jestHooks.onTestRunComplete((results) => {
      run += 1;
      parentPort?.postMessage({
        type: "result",
        vendor: "jest",
        run,
        json: {
          vendor: "jest",
          run,
          ...summarizeAggregatedResult(results),
        },
        text: formatTextResult(results),
      });
    });
  }

  getUsageInfo() {
    return null;
  }
}

module.exports = JestEventWatchPlugin;
