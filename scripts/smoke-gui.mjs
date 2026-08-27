#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const desktopAppDir = path.join(repoRoot, "apps", "desktop");
const artifactsDir = path.join(repoRoot, ".artifacts", "screenshots");

fs.mkdirSync(artifactsDir, { recursive: true });

async function runSmoke() {
  console.log("🚀 Launching Cozea Desktop via Playwright Electron...");
  const errors = [];
  const consoleLogs = [];

  const electronApp = await electron.launch({
    args: [desktopAppDir],
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "true",
      CI: "true",
    },
    timeout: 45000,
  });

  try {
    const window = await electronApp.firstWindow({ timeout: 45000 });
    console.log("✅ First Electron BrowserWindow opened.");

    window.on("console", (msg) => {
      const entry = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(entry);
      if (msg.type() === "error") {
        errors.push(entry);
      }
    });

    window.on("pageerror", (err) => {
      errors.push(`[pageerror] ${err.message}`);
    });

    await window.waitForLoadState("domcontentloaded");
    await window.waitForTimeout(2000);

    const title = await window.title();
    console.log(`📌 Window Title: "${title}"`);

    const shot1 = path.join(artifactsDir, "01-packaged-window.png");
    await window.screenshot({ path: shot1 });
    console.log(`📸 Captured: ${shot1}`);

    const rootElement = await window.$("#root");
    if (!rootElement) {
      throw new Error("React #root element not found in DOM");
    }
    console.log("✅ React root element mounted successfully.");

    const metrics = await window.evaluate(() => ({
      href: window.location.href,
      readyState: document.readyState,
      childElementCount: document.body.childElementCount,
      hasCozeaBridge: typeof window.desktopBridge !== "undefined",
    }));
    console.log("📊 UI Metrics:", JSON.stringify(metrics, null, 2));

    console.log(`\n📋 Console Summary: ${consoleLogs.length} logs, ${errors.length} errors.`);
  } finally {
    await electronApp.close();
  }
}

runSmoke().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
