#!/usr/bin/env node
/**
 * Navigation Test Build Wrapper
 * Conforms to Section 17.2 of docs/perf/navigation-runtime-plan.md
 */

import { execSync } from 'node:child_process';

console.log('[Build Navigation Test] Invoking production build with navigation test hooks enabled...');
try {
  process.env.COZEA_NAVIGATION_TEST = '1';
  execSync('bun run build', { stdio: 'inherit' });
  console.log('[Build Navigation Test] Build complete.');
} catch (err) {
  console.error('[Build Navigation Test] Build failed:', err);
  process.exit(1);
}
