const path = require("node:path");
const { createRequire } = require("node:module");

const packageRoot = path.resolve(__dirname, "..");
const mode = process.argv[2] ?? "watch-plugin";
const reporterResultsDir = path.join("/private/tmp", "demo-jest-watch-api");
const reporterResultsFile = path.join(reporterResultsDir, "reporter-results.json");
const reporterTextResultsFile = path.join(reporterResultsDir, "reporter-results.txt");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (mode === "all" || mode === "results") {
    printSplitRunInstructions();
    return;
  }

  if (mode === "exit") {
    printExitFinding();
    return;
  }

  if (mode !== "reporter" && mode !== "watch-plugin" && mode !== "native-watch") {
    throw new Error('Unknown mode. Use "reporter", "watch-plugin", "native-watch", "results", or "exit".');
  }

  const { runCLI } = require(resolveJestPath());
  const config = {
    rootDir: packageRoot,
    testMatch: ["<rootDir>/fixtures/**/*.test.cjs"],
    watchPathIgnorePatterns: [reporterResultsDir, "<rootDir>/results/"],
  };
  if (mode === "reporter") {
    config.reporters = [
      "default",
      [
        path.join(packageRoot, "src/result-reporter.cjs"),
        { label: mode, outputFile: reporterResultsFile, textOutputFile: reporterTextResultsFile },
      ],
    ];
  } else if (mode === "watch-plugin") {
    config.reporters = [];
  }

  const argv = {
    _: [],
    $0: "demo-jest-watch-api",
    colors: false,
    config: JSON.stringify(config),
    passWithNoTests: true,
    runInBand: true,
    silent: true,
    watch: false,
    watchAll: true,
  };

  if (mode === "watch-plugin") {
    argv.watchPlugins = [[path.join(packageRoot, "src/result-watch-plugin.cjs"), { label: mode }]];
  }

  await runCLI(argv, [packageRoot]);
  console.log("Unexpected: runCLI resolved in watch mode.");
}

function resolveJestPath() {
  try {
    return require.resolve("jest");
  } catch {
    const demoVendorsRequire = createRequire(path.join(packageRoot, "../demo-vendors/package.json"));
    return demoVendorsRequire.resolve("jest");
  }
}

function printSplitRunInstructions() {
  console.log("Run these separately, because each probe starts a native Jest watch process:");
  console.log("pnpm --filter demo-jest-watch-api demo:reporter");
  console.log("pnpm --filter demo-jest-watch-api demo:watch-plugin");
  console.log("pnpm --filter demo-jest-watch-api demo:native-watch");
}

function printExitFinding() {
  console.log("Jest 30.4.x runCLI watch mode does not expose a public close/stop handle.");
  console.log("Native watch exits are process-level interactions: q, Ctrl+C, or Ctrl+D.");
  console.log("For an embedded vendor, this means shutdown needs an isolation boundary plus a bounded fallback.");
}
