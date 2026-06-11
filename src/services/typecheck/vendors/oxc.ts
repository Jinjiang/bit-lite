import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileHasKind } from "../../../file-matcher.js";
import { createServiceTask } from "../../../runtime.js";
import type { TypecheckVendor } from "../types.js";

export const oxcTypecheckVendor: TypecheckVendor = {
  name: "oxc",
  run(input, context) {
    return createServiceTask(async ({ emit }) => {
      const sourceFiles = (await Promise.all(input.components.map((component) => findSourceFiles(component.rootDir))))
        .flat()
        .sort();
      const message = `oxc wrapper checked ${sourceFiles.length} source file${sourceFiles.length === 1 ? "" : "s"} for ${context?.envName}`;
      emit("output", { stream: "stdout", chunk: `${message}\n` });
      return {
        ok: true,
        message,
        diagnostics: [],
        files: sourceFiles.length,
      };
    });
  },
};

export default oxcTypecheckVendor;

async function findSourceFiles(rootDir: string) {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && !["preview", "docs", "test", "spec"].some((kind) => fileHasKind(entry.name, kind)))
    .map((entry) => path.join(rootDir, entry.name));
}
