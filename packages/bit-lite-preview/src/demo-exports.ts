import path from "node:path";
import ts from "typescript";
import { PreviewPreparationError } from "./errors.js";

/**
 * What: the names a demo file exports as values, read from its syntax alone.
 *
 * Why syntax rather than the type checker: a demo file is compiled by the env's
 * own vendor, and a preview must be preparable before any of that has run. The
 * parser is enough — the question is only which exports exist at runtime, and
 * that is decided by the file's own text.
 *
 * Type-only exports are the whole difficulty. `export { Props }` where `Props`
 * is a local interface disappears at runtime, and listing it would produce a
 * composition that fails to load. So local type declarations and type-only
 * imports are tracked and excluded, while anything re-exported from another
 * module is kept: this file cannot see whether that name is a type.
 */
export function discoverRuntimeExportNames(source: string, filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(filePath)
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }
  ).parseDiagnostics;
  if (parseDiagnostics && parseDiagnostics.length > 0) {
    const diagnostic = parseDiagnostics[0];
    const message = diagnostic ? ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n") : "unknown parse error";
    throw new PreviewPreparationError(`could not parse demo file ${filePath}: ${message}`);
  }

  const localTypes = collectLocalTypeOnlyNames(sourceFile);
  const localValues = collectLocalValueNames(sourceFile);
  const exportNames: string[] = [];
  const seen = new Set<string>();
  const add = (exportName: string) => {
    if (seen.has(exportName)) return;
    seen.add(exportName);
    exportNames.push(exportName);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      if (!statement.isExportEquals) add("default");
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      if (!statement.exportClause) {
        throw new PreviewPreparationError(
          `demo file ${filePath} uses unsupported unresolved export *; use explicit named exports instead`
        );
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        add(statement.exportClause.name.text);
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const localName = element.propertyName?.text ?? element.name.text;
        if (!statement.moduleSpecifier && localTypes.has(localName) && !localValues.has(localName)) continue;
        add(element.name.text);
      }
      continue;
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (isTypeOnlyDeclaration(statement) || hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) continue;
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      add("default");
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of readBindingNames(declaration.name)) add(name);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name
    ) {
      add(statement.name.text);
    }
  }

  return exportNames;
}

function collectLocalTypeOnlyNames(sourceFile: ts.SourceFile) {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      names.add(statement.name.text);
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const { importClause } = statement;
    if (importClause.isTypeOnly) {
      if (importClause.name) names.add(importClause.name.text);
      if (importClause.namedBindings) {
        for (const name of readImportBindingNames(importClause.namedBindings)) names.add(name);
      }
      continue;
    }
    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        if (element.isTypeOnly) names.add(element.name.text);
      }
    }
  }
  return names;
}

function collectLocalValueNames(sourceFile: ts.SourceFile) {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of readBindingNames(declaration.name)) names.add(name);
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const { importClause } = statement;
    if (importClause.name) names.add(importClause.name.text);
    if (!importClause.namedBindings) continue;
    if (ts.isNamespaceImport(importClause.namedBindings)) {
      names.add(importClause.namedBindings.name.text);
    } else {
      for (const element of importClause.namedBindings.elements) {
        if (!element.isTypeOnly) names.add(element.name.text);
      }
    }
  }
  return names;
}

function readBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : readBindingNames(element.name)));
}

function readImportBindingNames(bindings: ts.NamedImportBindings) {
  return ts.isNamespaceImport(bindings)
    ? [bindings.name.text]
    : bindings.elements.map((element) => element.name.text);
}

function isTypeOnlyDeclaration(statement: ts.Statement) {
  return ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function readScriptKind(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".jsx": return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

