// Copy lint: the mechanical copy rules of docs/contracts.md section 7 on user-facing text.
//
//   node scripts/copy-lint.ts            checks the default targets below
//   node scripts/copy-lint.ts PATH ...   checks the given files or directories instead
//
// Default targets: string literals and JSX text in app/, components/ and pages/ .tsx files, the lib
// modules that hold UI text (LIB_UI_TEXT), README.md when present, and everything under portfolio/
// when present. The prompt and the test files stay out: they quote the banned words on purpose. Flags em and en dashes
// (also figure dash and horizontal bar) and the banned words, whole word and case-insensitive.
// "leverage" is banned only as a verb, which a regex cannot tell apart, so every use is flagged.
// Exits 1 on any finding.
//
// Not user-facing, so skipped in .tsx: comments, module specifiers, type-level strings, object
// keys, directives, class and style strings, and attributes such as href, src, id or d.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { copyFindings } from "../lib/notes/copy-rules.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));

const CODE_EXT = new Set([".tsx", ".ts", ".jsx"]);

/** lib modules whose strings reach the page: lap flags, route messages, formatters, templates. */
const LIB_UI_TEXT = [
  "lib/data.ts",
  "lib/notes/handler.ts",
  "lib/notes/template.ts",
  "lib/analysis/format.ts",
  "lib/ui/radio.ts",
];
const TEXT_EXT = new Set([".md", ".mdx", ".txt", ".html"]);

/** JSX attributes whose values are never read by a person. */
const SKIP_ATTRS = new Set([
  "className",
  "class",
  "style",
  "key",
  "id",
  "href",
  "src",
  "srcSet",
  "rel",
  "target",
  "type",
  "role",
  "htmlFor",
  "name",
  "method",
  "action",
  "xmlns",
  "viewBox",
  "d",
  "fill",
  "stroke",
  "points",
  "transform",
  "lang",
  "dir",
  "as",
  "media",
  "sizes",
  "crossOrigin",
  "integrity",
  "form",
  "list",
  "inputMode",
  "autoComplete",
  "aria-hidden",
  "aria-controls",
  "aria-describedby",
  "aria-labelledby",
  "aria-current",
]);

/** Calls whose string arguments are class names. */
const CLASS_CALLS = new Set(["cn", "clsx", "cx", "twMerge", "cva"]);

type Finding = {
  file: string;
  line: number;
  col: number;
  rule: string;
  match: string;
  text: string;
};

const findings: Finding[] = [];
let filesChecked = 0;

function report(file: string, text: string, line0: number, col0: number): void {
  for (const f of copyFindings(text)) {
    const before = text.slice(0, f.index);
    const nl = before.lastIndexOf("\n");
    const line = line0 + (before.match(/\n/g)?.length ?? 0);
    const col = nl === -1 ? col0 + f.index : f.index - nl;
    const lineText = text.split("\n")[line - line0] ?? "";
    findings.push({
      file: relative(repo, file),
      line,
      col,
      rule: f.rule === "dash" ? "dash" : "banned word",
      match: f.match,
      text: lineText.trim().slice(0, 100),
    });
  }
}

function skipped(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p !== undefined; p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportTypeNode(p)) {
      return true;
    }
    if (ts.isTypeNode(p) && !ts.isExpressionWithTypeArguments(p)) return true;
    if (ts.isJsxAttribute(p)) {
      const name = p.name.getText();
      return SKIP_ATTRS.has(name) || name.startsWith("data-");
    }
    if (ts.isCallExpression(p)) {
      const callee = p.expression.getText();
      if (callee === "require" || p.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
      if (CLASS_CALLS.has(callee)) return true;
    }
    if (ts.isExpressionStatement(p) && ts.isStringLiteral(p.expression)) return true; // directive
  }
  const parent = node.parent;
  if (parent !== undefined && (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent))) {
    if (parent.name === node) return true; // object key
  }
  return false;
}

function lintCode(file: string): void {
  const src = readFileSync(file, "utf8");
  const kind =
    file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const visit = (node: ts.Node): void => {
    let text: string | null = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text;
    } else if (ts.isJsxText(node)) {
      text = node.getText(sf);
    }
    if (text !== null && !skipped(node)) {
      const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      report(file, text, pos.line + 1, pos.character + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function lintText(file: string): void {
  report(file, readFileSync(file, "utf8"), 1, 1);
}

function lintPath(path: string, codeExts: Set<string>): void {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path).sort()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      lintPath(join(path, entry), codeExts);
    }
    return;
  }
  const ext = extname(path);
  if (codeExts.has(ext)) {
    filesChecked++;
    lintCode(path);
  } else if (TEXT_EXT.has(ext)) {
    filesChecked++;
    lintText(path);
  }
}

const args = process.argv.slice(2);
if (args.length > 0) {
  for (const a of args) lintPath(resolve(a), CODE_EXT);
} else {
  const tsxOnly = new Set([".tsx"]);
  lintPath(join(repo, "app"), tsxOnly);
  lintPath(join(repo, "components"), tsxOnly);
  lintPath(join(repo, "pages"), tsxOnly);
  for (const f of LIB_UI_TEXT) lintPath(join(repo, f), CODE_EXT);
  lintPath(join(repo, "README.md"), CODE_EXT);
  lintPath(join(repo, "portfolio"), CODE_EXT);
}

for (const f of findings) {
  console.error(`${f.file}:${f.line}:${f.col}  ${f.rule}  ${JSON.stringify(f.match)}  ${f.text}`);
}
console.log(`copy lint: ${filesChecked} files, ${findings.length} findings`);
process.exit(findings.length > 0 ? 1 : 0);
