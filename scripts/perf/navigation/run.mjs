#!/usr/bin/env node
/** Fail closed until the real Electron navigation harness is installed. */
console.error('[Navigation validation] BLOCKED: the previous runner did not execute Electron or measure navigation.');
console.error('No correctness or performance verdict is available. Run the real integration harness after the repair cutover.');
process.exitCode = 2;
