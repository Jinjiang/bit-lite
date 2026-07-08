const { parentPort } = require("node:worker_threads");
const { createJestResult, formatJestTextResult } = require("../jest-result-format.cjs");

let run = 0;

class JestEventWatchPlugin {
  apply(jestHooks) {
    jestHooks.onTestRunComplete((results) => {
      run += 1;
      parentPort?.postMessage({
        type: "result",
        vendor: "jest",
        run,
        json: createJestResult(run, results),
        text: formatJestTextResult(results),
      });
    });
  }

  getUsageInfo() {
    return null;
  }
}

module.exports = JestEventWatchPlugin;
