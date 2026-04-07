import { spawn } from 'child_process';
import readline from 'readline';

const mcp = spawn('npx', ['-y', 'chrome-devtools-mcp', '--browserUrl', 'http://127.0.0.1:9222'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

const rl = readline.createInterface({
  input: mcp.stdout,
  terminal: false
});

let messageId = 1;
const requests = new Map();

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id && requests.has(msg.id)) {
      requests.get(msg.id)(msg);
      requests.delete(msg.id);
    }
  } catch (e) {}
});

function sendRequest(method, params = {}) {
  return new Promise((resolve) => {
    const id = messageId++;
    requests.set(id, resolve);
    const req = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    });
    mcp.stdin.write(req + '\n');
  });
}

async function run() {
  await sendRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" }
  });
  await sendRequest("notifications/initialized");

  console.log("Starting trace with autoStop (this will reload the page and wait for LCP)...");
  const traceRes = await sendRequest("tools/call", {
    name: "performance_start_trace",
    arguments: { reload: true, autoStop: true }
  });
  
  const summary = traceRes.result?.content?.[0]?.text || "";
  const match = summary.match(/insight set id:\s*(NAVIGATION_\d+)/);
  const insightSetId = match ? match[1] : "NAVIGATION_0";
  
  console.log(`Using insightSetId: ${insightSetId}`);

  console.log("\nFetching LCP Breakdown...");
  const lcpRes = await sendRequest("tools/call", {
    name: "performance_analyze_insight",
    arguments: { insightSetId, insightName: "LCPBreakdown" }
  });
  console.log("==== LCP Breakdown Insight ====\n");
  console.log(lcpRes.result?.content?.[0]?.text || JSON.stringify(lcpRes));

  console.log("\nFetching Forced Reflow...");
  const reflowRes = await sendRequest("tools/call", {
    name: "performance_analyze_insight",
    arguments: { insightSetId, insightName: "ForcedReflow" }
  });
  console.log("==== Forced Reflow Insight ====\n");
  console.log(reflowRes.result?.content?.[0]?.text || JSON.stringify(reflowRes));

  process.exit(0);
}

setTimeout(run, 1000);
