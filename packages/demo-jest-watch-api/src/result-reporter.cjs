const { summarizeAggregatedResult } = require("./result-summary.cjs");
const { appendJsonResult } = require("./write-json-result.cjs");
const { appendTextResult } = require("./write-text-result.cjs");

class ResultReporter {
  constructor(_globalConfig, options) {
    this.options = options ?? {};
  }

  onRunComplete(_testContexts, results) {
    appendJsonResult(this.options.outputFile, {
      source: "reporter",
      label: this.options.label,
      note: "Reporter onRunComplete fires before Jest assigns the final AggregatedResult.success value.",
      summary: summarizeAggregatedResult(results),
      runCLI: "still pending in watch mode",
    });
    appendTextResult(this.options.textOutputFile, results);
  }
}

module.exports = ResultReporter;
