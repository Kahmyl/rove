#!/usr/bin/env node
// Static repository checks. Runtime behavior is qualified by the test suite.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import console from "node:console";
import process from "node:process";
import ts from "typescript";
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  ),
].filter((p) => existsSync(p) && statSync(p).isFile());
const errors = [];
const forbidden =
  /(?:^|[\/._:-])(?:phase[-_]?\d+|milestone[-_]?\d+|gate[-_]?\d+|m\d+|p\d+(?:\.\d+)*|v\d+)(?=$|[\/._:-])/i;
const ticket = /(?:^|\/)[A-Z]{2,8}-\d+(?=$|[._/-])/;
const suffixes = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".d.ts",
  ".d.mts",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];
function resolvesImport(file, spec) {
  if (!spec.startsWith(".")) return true;
  const absolute = resolve(dirname(file), spec);
  // Built artifacts are checked by the build/package checks, not a clean-tree scan.
  if (absolute.split(/[\\/]/).includes("dist")) return true;
  const sourceStem = absolute.replace(/\.(?:[cm]?js|jsx)$/, "");
  return [absolute, sourceStem].some((base) =>
    suffixes.some((s) => existsSync(base + s) && statSync(base + s).isFile()),
  );
}
let imports = 0,
  links = 0;
for (const file of files) {
  if (forbidden.test(file) || ticket.test(file))
    errors.push(`Milestone/product-edition filename: ${file}`);
  const extension = extname(file);
  if (
    ![
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
      ".mjs",
      ".cjs",
      ".js",
      ".json",
      ".md",
    ].includes(extension)
  )
    continue;
  const text = readFileSync(file, "utf8");
  if (extension === ".json") {
    try {
      const value = JSON.parse(text);
      if (file.endsWith("package.json"))
        for (const key of Object.keys(value.scripts ?? {}))
          if (forbidden.test(key))
            errors.push(`Milestone script: ${file}: ${key}`);
    } catch (error) {
      errors.push(`Invalid JSON: ${file}: ${error.message}`);
    }
  }
  if (
    extension === ".md" &&
    (file.startsWith("docs/") ||
      ["README.md", "AGENTS.md", "CONTRIBUTING.md"].includes(file))
  ) {
    const prose = text.replace(/```[^\n]*\n[\s\S]*?```/g, "");
    for (const match of prose.matchAll(
      /\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
    )) {
      const target = match[1].replace(/^<|>$/g, "");
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#"))
        continue;
      const path = decodeURIComponent(target.split("#")[0].split("?")[0]);
      if (!path) continue;
      links++;
      if (!existsSync(resolve(dirname(file), path)))
        errors.push(`Broken document link: ${file} -> ${target}`);
    }
  }
  if (
    [".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js"].includes(extension)
  ) {
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ["describe", "it", "test"].includes(node.expression.text) &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        /\b(?:Phase\s*\d+|Milestone\s*\d+|Gate\s*\d+|M\d+|P\d+\.\d+|F\d+\.\d+|Wave\s*\d+)\b/i.test(
          node.arguments[0].text,
        )
      )
        errors.push(`Milestone test label: ${file}: ${node.arguments[0].text}`);
      let literal;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        literal = node.moduleSpecifier;
      else if (
        ts.isCallExpression(node) &&
        node.arguments.length &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      )
        literal = node.arguments[0];
      if (
        literal &&
        ts.isStringLiteralLike(literal) &&
        literal.text.startsWith(".")
      ) {
        imports++;
        if (!resolvesImport(file, literal.text))
          errors.push(`Unresolved relative import: ${file} -> ${literal.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  execFileSync(process.execPath, ["scripts/check-codex-environment.mjs"], {
    stdio: "inherit",
  });
  console.log(
    `Repository checks passed: ${files.length} files, ${imports} relative imports, ${links} local document links.`,
  );
}
