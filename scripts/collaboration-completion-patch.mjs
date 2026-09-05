#!/usr/bin/env node
// Temporary, branch-scoped implementation driver. Removed before review.
import fs from "node:fs";

const edits = new Map();
function replace(file, before, after) {
  const source = edits.get(file) ?? fs.readFileSync(file, "utf8");
  if (after && source.includes(after)) return;
  if (source.split(before).length !== 2) throw new Error(`Expected one patch anchor in ${file}`);
  edits.set(file, source.replace(before, after));
}

const manager = "apps/desktop/electron/substrate/ShadowServerManager.ts";
replace(manager, 'import { fork, type ChildProcess } from "node:child_process";', 'import { fork, type ChildProcess } from "node:child_process";\nimport { stopChildProcessVerified } from "../../../../shared/verifiedChildProcessStop";');
const delay = `function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

`;
if ((edits.get(manager) ?? fs.readFileSync(manager, "utf8")).includes(delay)) replace(manager, delay, "");
replace(manager, `    await this.stopChild(child);
    this.child = null;
    this.phase = "stopped";`, `    try {
      await this.stopChild(child);
    } catch (error) {
      this.phase = "error";
      this.lastError = "Chat server termination could not be confirmed; retry shutdown";
      throw error;
    }
    this.child = null;
    this.phase = "stopped";`);
const managerSource = edits.get(manager) ?? fs.readFileSync(manager, "utf8");
const start = managerSource.indexOf("  private async stopChild(child: ChildProcess | null): Promise<void> {");
const end = managerSource.indexOf("  private appendManagerLog", start);
if (start < 0 || end < 0) throw new Error("Missing owned shadow shutdown anchors");
replace(manager, managerSource.slice(start, end), `  private async stopChild(child: ChildProcess | null): Promise<void> {
    await stopChildProcessVerified(child, { graceMs: this.stopGraceMs, killWaitMs: 2_000 });
  }

`);

const processFile = "apps/server/src/t3/process.ts";
replace(processFile, 'import { spawn } from "node:child_process";', 'import { spawn } from "node:child_process";\nimport { stopChildProcessVerified } from "../../../../shared/verifiedChildProcessStop.ts";');
replace(processFile, `    child.kill("SIGTERM");
    throw error;`, `    await stopChildProcessVerified(child, { graceMs: 2_000, killWaitMs: 2_000 });
    throw error;`);
replace(processFile, `    stop: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },`, `    stop: () => stopChildProcessVerified(child, { graceMs: 2_000, killWaitMs: 2_000 }),`);

for (const [file, content] of edits) {
  console.log(file);
  if (!process.argv.includes("--check")) fs.writeFileSync(file, content);
}
