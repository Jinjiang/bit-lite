import path from "node:path";
import ts from "typescript";
import { readObjectConfig, rejectCliArgs } from "../../../service-config.js";
import { createServiceTask } from "../../../runtime.js";
import { serviceResult } from "../../../utils/service-result.js";
import type { TypecheckDiagnostic, TypecheckResult, TypecheckVendor } from "../../../types/services/typecheck.js";

export const typescriptApiTypecheckVendor: TypecheckVendor = {
  name: "typescript-api",
  run(input, context) {
    return createServiceTask(async () => {
      const workspaceRoot = requireWorkspaceRoot(context);
      rejectCliArgs(input.args, "typecheck");
      const config = readObjectConfig(input.config);
      const tsconfig = typeof config.tsconfig === "string" ? config.tsconfig : "tsconfig.json";
      return runTypeScriptApi(path.resolve(workspaceRoot, tsconfig), context?.envName);
    });
  },
};

export default typescriptApiTypecheckVendor;

function runTypeScriptApi(tsconfigPath: string, envName: string | undefined): TypecheckResult {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const configDir = path.dirname(tsconfigPath);
  const parsed = configFile.error
    ? undefined
    : ts.parseJsonConfigFileContent(configFile.config, ts.sys, configDir);
  const diagnostics = [
    ...(configFile.error ? [configFile.error] : []),
    ...(parsed?.errors ?? []),
  ];
  const program = parsed ? ts.createProgram(parsed.fileNames, parsed.options) : undefined;
  if (program) diagnostics.push(...ts.getPreEmitDiagnostics(program));

  const typecheckDiagnostics = diagnostics.map(toTypecheckDiagnostic);
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error).length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Warning).length;
  const ok = errors === 0;
  const text = ok ? `typecheck passed for ${envName}` : `typecheck failed for ${envName}: ${errors} errors`;

  return serviceResult({
    ok,
    toJSON: () => ({
      checker: "typescript",
      runner: "api",
      envName,
      files: parsed?.fileNames.length ?? 0,
      errors,
      warnings,
      diagnostics: typecheckDiagnostics,
    }),
    toString: () => text,
    toTerminalString: () => ok ? text : `${text}\n${formatDiagnostics(typecheckDiagnostics)}`,
  });
}

function toTypecheckDiagnostic(diagnostic: ts.Diagnostic): TypecheckDiagnostic {
  const position = getDiagnosticPosition(diagnostic);
  return {
    severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ...(diagnostic.code ? { code: diagnostic.code } : {}),
    ...(position?.file ? { file: position.file } : {}),
    ...(position?.line ? { line: position.line } : {}),
    ...(position?.column ? { column: position.column } : {}),
  };
}

function getDiagnosticPosition(diagnostic: ts.Diagnostic) {
  if (!diagnostic.file || diagnostic.start === undefined) return undefined;
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return {
    file: diagnostic.file.fileName,
    line: position.line + 1,
    column: position.character + 1,
  };
}

function formatDiagnostics(diagnostics: TypecheckDiagnostic[]) {
  return diagnostics
    .map((diagnostic) => {
      const location = diagnostic.file
        ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}${diagnostic.column ? `:${diagnostic.column}` : ""}`
        : "(unknown)";
      const code = diagnostic.code ? ` TS${diagnostic.code}` : "";
      return `${location} - ${diagnostic.severity}${code}: ${diagnostic.message}`;
    })
    .join("\n");
}

function requireWorkspaceRoot(context: { workspaceRoot?: string } | undefined) {
  if (!context?.workspaceRoot) throw new Error("typecheck requires workspaceRoot in context");
  return context.workspaceRoot;
}
