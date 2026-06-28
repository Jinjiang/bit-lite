export type ServiceKind = "lint" | "test" | "compile";

export type ApiKind =
  | "js-api"
  | "module-api"
  | "custom-reporter"
  | "cli-json"
  | "cli"
  | "unsupported";

export type Severity = "error" | "warning" | "info";

export interface BaseServiceResult {
  service: ServiceKind;
  vendor: string;
  apiKind: ApiKind;
  ok: boolean;
  durationMs: number;
  targetFiles: string[];
  notes?: string[];
  raw?: unknown;
}

export interface ServiceRunOptions {
  cwd?: string;
  targetFiles?: string[];
  configFile?: string;
  projectDir?: string;
  outputDir?: string;
  env?: Record<string, string | undefined>;
}

export interface SourceLocation {
  filePath: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface ServiceDiagnostic {
  message: string;
  severity: Severity;
  source?: string;
  ruleId?: string;
  location?: SourceLocation;
}

export interface LintServiceResult extends BaseServiceResult {
  service: "lint";
  diagnostics: ServiceDiagnostic[];
  summary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
}

export type TestStatus = "passed" | "failed" | "skipped" | "todo";

export interface TestFailure {
  message: string;
  stack?: string;
  location?: SourceLocation;
}

export interface TestCaseResult {
  name: string;
  status: TestStatus;
  durationMs?: number;
  filePath?: string;
  failures?: TestFailure[];
}

export interface TestSuiteResult {
  name: string;
  filePath?: string;
  status: TestStatus;
  durationMs?: number;
  tests: TestCaseResult[];
}

export interface TestServiceResult extends BaseServiceResult {
  service: "test";
  watchMode: boolean;
  suites: TestSuiteResult[];
  tests: TestCaseResult[];
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    todo: number;
    total: number;
  };
}

export interface CompileOutput {
  filePath?: string;
  kind: "js" | "css" | "map" | "asset" | "meta";
  code?: string;
  bytes?: number;
}

export interface CompileServiceResult extends BaseServiceResult {
  service: "compile";
  outputs: CompileOutput[];
  diagnostics: ServiceDiagnostic[];
  summary: {
    outputCount: number;
    errorCount: number;
    warningCount: number;
  };
}

export type DemoServiceResult =
  | LintServiceResult
  | TestServiceResult
  | CompileServiceResult;
