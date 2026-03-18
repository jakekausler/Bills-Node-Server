#!/usr/bin/env npx tsx
/**
 * build_log_registry.ts
 *
 * Static analysis script that scans calculate-v3 source files for debug log
 * calls and produces a machine-readable registry (JSON) plus a human-readable
 * Markdown table.
 *
 * Detected patterns:
 *
 *   Pattern A  –  component helper shorthand
 *     this.log("event-name", { field1: val, field2: val })
 *
 *   Pattern B  –  direct debugLogger call
 *     this.debugLogger.log(sim, { component: "x", event: "y", ...fields })
 *
 * Usage:
 *   npx tsx scripts/build_log_registry.ts
 *
 * Outputs:
 *   scripts/log_registry.json
 *   scripts/log_registry.md
 */

import { Project, SyntaxKind, Node, CallExpression } from "ts-morph";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface LogEntry {
  component: string;
  event: string;
  file: string;
  line: number;
  fields: string[];
}

const ROOT = path.resolve(__dirname, "..");
const CALC_DIR = path.join(ROOT, "src", "utils", "calculate-v3");
const OUT_DIR = path.resolve(__dirname);

function extractStringLiteral(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node)) {
    return node.getLiteralValue();
  }
  return undefined;
}

function extractObjectKeys(node: Node | undefined): string[] {
  if (!node || !Node.isObjectLiteralExpression(node)) return [];
  return node.getProperties().map((prop) => {
    if (Node.isPropertyAssignment(prop)) {
      return prop.getName();
    }
    if (Node.isShorthandPropertyAssignment(prop)) {
      return prop.getName();
    }
    if (Node.isSpreadAssignment(prop)) {
      return `...${prop.getExpression().getText()}`;
    }
    return prop.getText();
  });
}

function isThisPropertyAccess(
  call: CallExpression,
  methodName: string
): boolean {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return false;
  if (expr.getName() !== methodName) return false;
  const obj = expr.getExpression();
  return obj.getKind() === SyntaxKind.ThisKeyword;
}

function isThisDebugLoggerLog(call: CallExpression): boolean {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return false;
  if (expr.getName() !== "log") return false;

  const mid = expr.getExpression();
  if (!Node.isPropertyAccessExpression(mid)) return false;
  if (mid.getName() !== "debugLogger") return false;

  const obj = mid.getExpression();
  return obj.getKind() === SyntaxKind.ThisKeyword;
}

function deriveComponentFromFile(filePath: string): string {
  const base = path.basename(filePath, ".ts");
  // e.g. "tax-manager" -> "tax-manager"
  return base;
}

function scan(): LogEntry[] {
  const project = new Project({ tsConfigFilePath: undefined });

  // Add all .ts files in calculate-v3, excluding test files
  const globPattern = path.join(CALC_DIR, "**", "*.ts");
  project.addSourceFilesAtPaths(globPattern);

  const entries: LogEntry[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();

    // Skip test files
    if (filePath.includes(".test.") || filePath.includes(".spec.")) continue;

    const relativePath = path.relative(ROOT, filePath);

    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const call = node as CallExpression;

      // --- Pattern A: this.log("event", { ...fields }) ---
      if (isThisPropertyAccess(call, "log")) {
        const args = call.getArguments();
        if (args.length >= 1) {
          const event = extractStringLiteral(args[0]);
          if (event) {
            const fields =
              args.length >= 2 ? extractObjectKeys(args[1]) : [];
            entries.push({
              component: deriveComponentFromFile(filePath),
              event,
              file: relativePath,
              line: call.getStartLineNumber(),
              fields,
            });
          }
        }
      }

      // --- Pattern B: this.debugLogger.log(sim, { component, event, ... }) ---
      if (isThisDebugLoggerLog(call)) {
        const args = call.getArguments();
        // First arg is sim number, second is the log object
        if (args.length >= 2) {
          const obj = args[1];
          if (Node.isObjectLiteralExpression(obj)) {
            let component: string | undefined;
            let event: string | undefined;
            const fields: string[] = [];

            for (const prop of obj.getProperties()) {
              if (Node.isPropertyAssignment(prop)) {
                const name = prop.getName();
                if (name === "component") {
                  component = extractStringLiteral(
                    prop.getInitializerOrThrow()
                  );
                } else if (name === "event") {
                  event = extractStringLiteral(prop.getInitializerOrThrow());
                } else {
                  fields.push(name);
                }
              } else if (Node.isShorthandPropertyAssignment(prop)) {
                const name = prop.getName();
                if (name !== "component" && name !== "event") {
                  fields.push(name);
                }
              } else if (Node.isSpreadAssignment(prop)) {
                fields.push(`...${prop.getExpression().getText()}`);
              }
            }

            if (component && event) {
              entries.push({
                component,
                event,
                file: relativePath,
                line: call.getStartLineNumber(),
                fields,
              });
            }
          }
        }
      }
    });
  }

  // Sort by component, then event
  entries.sort((a, b) => {
    const cmp = a.component.localeCompare(b.component);
    if (cmp !== 0) return cmp;
    return a.event.localeCompare(b.event);
  });

  return entries;
}

function writeJSON(entries: LogEntry[]): void {
  const outPath = path.join(OUT_DIR, "log_registry.json");
  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${outPath} (${entries.length} entries)`);
}

function writeMarkdown(entries: LogEntry[]): void {
  const outPath = path.join(OUT_DIR, "log_registry.md");
  const lines: string[] = [
    "# Log Registry",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Total log points: ${entries.length}`,
    "",
    "| Component | Event | File | Line | Fields |",
    "|-----------|-------|------|------|--------|",
  ];

  for (const e of entries) {
    const shortFile = path.basename(e.file);
    const fields = e.fields.join(", ") || "(none)";
    lines.push(
      `| ${e.component} | ${e.event} | ${shortFile} | ${e.line} | ${fields} |`
    );
  }

  lines.push("");
  fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`Wrote ${outPath} (${entries.length} entries)`);
}

// --- Main ---
const entries = scan();
writeJSON(entries);
writeMarkdown(entries);

if (entries.length === 0) {
  console.log(
    "No log points found yet. Add this.log() or this.debugLogger.log() calls to calculate-v3 files."
  );
} else {
  console.log(`Found ${entries.length} log points across calculate-v3.`);
}
