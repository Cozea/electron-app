import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const TARGETS = [
  "node_modules/@legendapp/list/react.js",
  "node_modules/@legendapp/list/react.mjs",
];

const ORIGINAL_SNIPPET =
  "if (prevSizeKnown !== void 0 && Math.abs(prevSizeKnown - size) > 5) {\n      shouldMaintainScrollAtEnd = true;\n    }";

const LEGACY_PATCHED_SNIPPET =
  "const isWithinMaintainScrollAtEndThreshold = peek$(ctx, \"isWithinMaintainScrollAtEndThreshold\");\n    if (prevSizeKnown !== void 0 && (Math.abs(prevSizeKnown - size) > 5 || isWithinMaintainScrollAtEndThreshold)) {\n      shouldMaintainScrollAtEnd = true;\n    }";

const PATCHED_SNIPPET =
  "const sizeDelta = Math.abs(prevSizeKnown - size);\n    const isWithinMaintainScrollAtEndThreshold = peek$(ctx, \"isWithinMaintainScrollAtEndThreshold\");\n    if (prevSizeKnown !== void 0 && (sizeDelta > 5 || (isWithinMaintainScrollAtEndThreshold && sizeDelta >= 2))) {\n      shouldMaintainScrollAtEnd = true;\n    }";

function patchFile(targetPath) {
  if (!existsSync(targetPath)) {
    return;
  }

  const source = readFileSync(targetPath, "utf8");
  if (source.includes(PATCHED_SNIPPET)) {
    return;
  }
  let patched = source;
  if (patched.includes(LEGACY_PATCHED_SNIPPET)) {
    patched = patched.replace(LEGACY_PATCHED_SNIPPET, PATCHED_SNIPPET);
  } else if (patched.includes(ORIGINAL_SNIPPET)) {
    patched = patched.replace(ORIGINAL_SNIPPET, PATCHED_SNIPPET);
  } else {
    throw new Error(`LegendList patch anchor not found in ${targetPath}`);
  }
  writeFileSync(targetPath, patched);
}

for (const relativeTarget of TARGETS) {
  patchFile(path.resolve(process.cwd(), relativeTarget));
}
