import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const artifactsDir = path.join(repoRoot, ".artifacts", "screenshots");

async function main() {
  console.log("Connecting to Electron CDP on port 9222 for multi-tile verification...");
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const context = browser.contexts()[0];
  const page = context.pages().find((p) => !p.url().startsWith("devtools://")) || context.pages()[0];

  console.log(`Attached to Page: ${page.url()}`);
  await page.waitForTimeout(3000);

  const tileReport = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll(".dockview-tab, [role=\"tab\"]"))
      .map((t) => t.innerText.trim())
      .filter(Boolean);
    const panels = Array.from(document.querySelectorAll(".dockview-panel, [data-slot=\"workbench-tile-chrome\"]"))
      .map((p) => p.innerText.slice(0, 100).trim())
      .filter(Boolean);
    const xtermCount = document.querySelectorAll(".xterm, .xterm-screen").length;
    const composersCount = document.querySelectorAll("[role=\"textbox\"]").length;

    return { tabs, panelsCount: panels.length, xtermCount, composersCount };
  });

  console.log("📊 Multi-Tile Workbench State:", JSON.stringify(tileReport, null, 2));

  const shot = path.join(artifactsDir, "multi-tile-dockview-verified.png");
  await page.screenshot({ path: shot, timeout: 8000 });
  console.log(`📸 Captured: ${shot}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Multi-tile smoke test error:", err);
  process.exit(1);
});
