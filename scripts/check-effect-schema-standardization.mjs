import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SEARCH_DIRS = ["shared", "src", "electron", "server", "convex", "tests"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

const RULES = [
  {
    name: "polyfill import",
    regex: /from\s+["']\.\/effect-polyfill["']/g,
  },
  {
    name: "effect/Schema import",
    regex: /from\s+["']effect\/Schema["']/g,
  },
  {
    name: "unsupported schema shorthand",
    regex:
      /Schema\.(?:pattern|maxLength|minLength|maxItems|minItems|maxProperties|minProperties|lessThanOrEqualTo|greaterThanOrEqualTo|lessThan|greaterThan|extend|transformOrFail)\s*\(/g,
  },
  {
    name: "variadic Schema.Union",
    regex: /Schema\.Union\(\s*(?!\[)/g,
  },
  {
    name: "multi-value Schema.Literal",
    regex: /Schema\.Literal\(\s*(?:"[^"]+"\s*,|\.\.\.)/g,
  },
];

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "out" || entry.name === "dist") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
      continue;
    }
    if (EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function lineForIndex(text, index) {
  return text.slice(0, index).split("\n").length;
}

const violations = [];

for (const searchDir of SEARCH_DIRS) {
  const absoluteDir = path.join(ROOT, searchDir);
  if (!statSync(absoluteDir, { throwIfNoEntry: false })?.isDirectory()) {
    continue;
  }
  for (const filePath of walk(absoluteDir)) {
    const text = readFileSync(filePath, "utf8");
    for (const rule of RULES) {
      for (const match of text.matchAll(rule.regex)) {
        const line = lineForIndex(text, match.index ?? 0);
        violations.push({
          filePath: path.relative(ROOT, filePath),
          line,
          rule: rule.name,
          sample: match[0],
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Effect schema standardization check failed:");
  for (const violation of violations) {
    console.error(
      `- ${violation.filePath}:${violation.line} [${violation.rule}] ${violation.sample}`,
    );
  }
  process.exit(1);
}

console.log("Effect schema standardization check passed.");
