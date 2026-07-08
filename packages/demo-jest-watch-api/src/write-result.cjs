function writeResult(source, label, summary) {
  const payload = {
    source,
    label,
    note:
      source === "reporter"
        ? "Reporter onRunComplete fires before Jest assigns the final AggregatedResult.success value."
        : "Watch plugin onTestRunComplete observes the processed watch result.",
    summary,
    runCLI: "still pending in watch mode",
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

module.exports = {
  writeResult,
};
