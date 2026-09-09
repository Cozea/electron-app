import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { promisify } from "node:util"
import { expect, it } from "vitest"

const execute = promisify(execFile)

// This repository's Electron/PTY tooling is qualified on macOS. Keep portable
// layout math in Vitest and exercise native renderer lifecycle on that host.
it.runIf(process.platform === "darwin")("preserves launcher and sidebar measurements across DOM replacements", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cozea-launcher-test-"))
  try {
    await execute("bun", [
      "build", "tests/workbench/fixtures/launcherViewport.tsx",
      "--target=browser", `--outfile=${join(directory, "renderer.js")}`,
    ])
    await writeFile(join(directory, "index.html"), '<!doctype html><script type="module" src="./renderer.js"></script>')
    await writeFile(join(directory, "main.cjs"), `
      const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(directory, "profile"))});
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
        try {
          await window.loadFile(${JSON.stringify(join(directory, "index.html"))});
          const checks = await window.webContents.executeJavaScript('window.runMeasurementChecks()');
          console.log('LAUNCHER_CHECKS=' + JSON.stringify(checks));
          app.exit(0);
        } catch (error) {
          console.error(String(error));
          app.exit(1);
        }
      });
    `)
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const { stdout } = await execute(
      resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
      [join(directory, "main.cjs")],
      { env: environment, timeout: 20_000 },
    )
    expect(stdout).toContain("List to grid measures the newly mounted viewport")
    expect(stdout).toContain("Grid to list to grid attaches to the replacement viewport")
    expect(stdout).toContain("Clipped running sidebar title retains its tooltip")
    expect(stdout).toContain("Idle title observer reattaches after the running state ends")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
