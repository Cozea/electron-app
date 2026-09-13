import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { promisify } from "node:util"
import { expect, it } from "vitest"

const execute = promisify(execFile)

it.runIf(process.platform === "darwin")("creates a PR from the exact review without duplicate clicks or merging", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cozea-pr-dialog-"))
  try {
    await execute("bun", ["build", "tests/collaboration/fixtures/sessionPullRequest.tsx", "--target=browser", `--outdir=${directory}`])
    await writeFile(join(directory, "index.html"), '<!doctype html><link rel="stylesheet" href="./sessionPullRequest.css"><script type="module" src="./sessionPullRequest.js"></script>')
    await writeFile(join(directory, "main.cjs"), `
      const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(directory, "profile"))});
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ show: false, width: 1000, webPreferences: { backgroundThrottling: false } });
        try {
          await window.loadFile(${JSON.stringify(join(directory, "index.html"))});
          window.webContents.focus();
          const checks = await window.webContents.executeJavaScript('window.runPullRequestChecks()');
          console.log('PR_CHECKS=' + JSON.stringify(checks));
          app.exit(0);
        } catch (error) { console.error(String(error)); app.exit(1); }
      });
    `)
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const { stdout } = await execute(resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"), [join(directory, "main.cjs")], { env: environment, timeout: 20_000 })
    expect(stdout).toContain("PR_DIALOG_OK")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
