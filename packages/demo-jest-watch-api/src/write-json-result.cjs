const fs = require("node:fs");
const path = require("node:path");

function appendJsonResult(outputFile, entry) {
  const resolvedOutputFile = path.resolve(outputFile);
  const entries = readExistingEntries(resolvedOutputFile);

  entries.push({
    observedAt: new Date().toISOString(),
    ...entry,
  });

  fs.mkdirSync(path.dirname(resolvedOutputFile), { recursive: true });
  fs.writeFileSync(resolvedOutputFile, `${JSON.stringify(entries, null, 2)}\n`);
}

function readExistingEntries(outputFile) {
  try {
    const content = fs.readFileSync(outputFile, "utf8").trim();
    if (content.length === 0) return [];

    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected ${outputFile} to contain a JSON array.`);
    }

    return parsed;
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

module.exports = {
  appendJsonResult,
};
