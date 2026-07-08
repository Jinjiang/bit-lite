const path = require("node:path");

function createVitestResult(run, testModules, unhandledErrors, reason) {
  const files = testModules.map(formatModule);
  const totals = files.reduce(
    (stats, file) => {
      stats.failed += file.stats.failed;
      stats.passed += file.stats.passed;
      stats.skipped += file.stats.skipped;
      stats.total += file.stats.total;
      stats.durationMs += file.durationMs;
      if (file.stats.failed > 0 || file.errors.length > 0) stats.failedFiles += 1;
      else stats.passedFiles += 1;
      return stats;
    },
    {
      failed: 0,
      passed: 0,
      skipped: 0,
      total: 0,
      failedFiles: 0,
      passedFiles: 0,
      durationMs: 0,
    }
  );

  totals.failed += unhandledErrors.length;
  if (unhandledErrors.length > 0 && files.length === 0) totals.failedFiles += 1;

  return {
    vendor: "vitest",
    run,
    reason,
    success: totals.failed === 0 && unhandledErrors.length === 0,
    stats: totals,
    files,
    unhandledErrors: unhandledErrors.map(formatError),
  };
}

function formatVitestTextResult(result) {
  const lines = [];

  for (const file of result.files) {
    lines.push(`${file.status} ${relativePath(file.filePath)}`);
    for (const error of file.errors) {
      lines.push("", indent(error), "");
    }
  }

  for (const error of result.unhandledErrors) {
    lines.push("FAIL unhandled error", "", indent(error), "");
  }

  lines.push(formatTestFilesSummary(result));
  lines.push(formatTestsSummary(result));
  lines.push(`Time:        ${(result.stats.durationMs / 1000).toFixed(3)} s`);

  return lines.filter(Boolean).join("\n");
}

function formatModule(module) {
  const tests = Array.from(module.children.allTests());
  const stats = {
    failed: 0,
    passed: 0,
    skipped: 0,
    total: 0,
  };
  const errors = [];

  for (const test of tests) {
    const result = test.result();
    stats.total += 1;
    if (result.state === "passed") stats.passed += 1;
    else if (result.state === "failed") {
      stats.failed += 1;
      errors.push(...(result.errors ?? []).map(formatError));
    } else {
      stats.skipped += 1;
    }
  }

  errors.push(...module.errors().map(formatError));

  return {
    filePath: module.moduleId,
    status: stats.failed > 0 || errors.length > 0 ? "FAIL" : "PASS",
    durationMs: module.diagnostic().duration,
    stats,
    errors,
  };
}

function formatTestFilesSummary(result) {
  return `Test Files:  ${formatCounts([
    ["failed", result.stats.failedFiles],
    ["passed", result.stats.passedFiles],
    ["total", result.files.length],
  ])}`;
}

function formatTestsSummary(result) {
  return `Tests:       ${formatCounts([
    ["failed", result.stats.failed],
    ["passed", result.stats.passed],
    ["skipped", result.stats.skipped],
    ["total", result.stats.total],
  ])}`;
}

function formatCounts(counts) {
  return counts
    .filter(([label, count]) => label === "total" || count > 0)
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
}

function formatError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.stack || error.message || JSON.stringify(error, null, 2);
}

function indent(text) {
  return String(text)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function relativePath(filePath) {
  return path.relative(process.cwd(), filePath) || filePath;
}

module.exports = {
  createVitestResult,
  formatVitestTextResult,
};
