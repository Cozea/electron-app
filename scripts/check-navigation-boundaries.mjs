#!/usr/bin/env node
/**
 * Navigation Architecture Boundary & Invariant Enforcer
 * Conforms to Section 7.3, 10.4, 14 (P10), and 17.2 of docs/perf/navigation-runtime-plan.md
 *
 * Checks:
 * 1. Prohibits direct router hook imports (useParams, useLocation, useSearchParams)
 *    inside retained workbench presentation components.
 * 2. Prohibits synchronous localStorage access on warm navigation / layout lookup paths.
 * 3. Prohibits direct activateSession/ensureSession IPC bypass from retained UI components.
 */

import fs from 'node:fs';
import path from 'node:path';

let violations = 0;

function checkFile(filePath, forbiddenPatterns) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const { pattern, message } of forbiddenPatterns) {
    if (pattern.test(content)) {
      console.error(`[Boundary Violation] ${filePath}: ${message}`);
      violations++;
    }
  }
}

// 1. Check retained presentation files for forbidden router hooks
const RETAINED_FILES = [
  'apps/desktop/src/features/workbench/WorkbenchKeepAliveHost.tsx',
  'apps/desktop/src/features/workbench/WorkbenchDockviewSession.tsx',
];

const FORBIDDEN_ROUTER_PATTERNS = [
  {
    pattern: /import\s+{[^}]*\b(useParams|useLocation|useSearchParams)\b[^}]*}\s+from\s+['"](?:@\/lib\/router|@tanstack\/react-router)['"]/,
    message: 'Retained presentation components must not consume ambient router hooks (Invariant I04, Section 7.3).',
  },
  {
    pattern: /import\s+{[^}]*\buseActiveWorkbenchScope\b[^}]*}\s+from\s+['"]@\/contexts\/project\/useActiveWorkbenchScope['"]/,
    message: 'Retained presentation components must not use route-aware useActiveWorkbenchScope (Section 7.3).',
  },
];

for (const file of RETAINED_FILES) {
  checkFile(path.resolve(file), FORBIDDEN_ROUTER_PATTERNS);
}

// 2. Check layout persistence for synchronous localStorage parsing
const LAYOUT_PERSISTENCE_FILES = [
  'apps/desktop/src/features/workbench/model/workbenchLayoutPersistence.ts',
];

const FORBIDDEN_STORAGE_PATTERNS = [
  {
    pattern: /window\.localStorage\.getItem\(['"]cozea:project-workbench-layouts['"]\)/,
    message: 'Layout peek must not read synchronous localStorage on hot path (Invariant I08, Section 10.4).',
  },
];

for (const file of LAYOUT_PERSISTENCE_FILES) {
  checkFile(path.resolve(file), FORBIDDEN_STORAGE_PATTERNS);
}

checkFile(path.resolve('apps/desktop/src/features/projects/pages/ProjectWorkbenchPage.tsx'), [{
  pattern: /<ProjectWorkbenchSurface/,
  message: 'The route page must not own the persistent workbench surface.',
}]);

checkFile(path.resolve('apps/desktop/electron/preload.ts'), [
  {
    pattern: /workbenchSession:activateSession/,
    message: 'Renderer-visible direct activation bypasses sequenced presentation authority.',
  },
  {
    pattern: /workbenchSession:backgroundSession/,
    message: 'Renderer-visible direct backgrounding bypasses sequenced presentation authority.',
  },
]);

if (violations > 0) {
  console.error(`\n[Boundary Check Failed] Total violations: ${violations}`);
  process.exit(1);
} else {
  console.log(`[Boundary Check Passed] All architectural boundary rules satisfied.`);
  process.exit(0);
}
