const { summarizeAggregatedResult } = require("./result-summary.cjs");
const { writeResult } = require("./write-result.cjs");

class ResultWatchPlugin {
  constructor(options = {}) {
    this.options = options.config ?? {};
  }

  apply(jestHooks) {
    jestHooks.onTestRunComplete((results) => {
      writeResult("watch-plugin", this.options.label, summarizeAggregatedResult(results));
    });
  }

  getUsageInfo() {
    return null;
  }
}

module.exports = ResultWatchPlugin;
