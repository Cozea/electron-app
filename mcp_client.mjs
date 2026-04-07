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
  // console.log('Received:', line);
  try {
    const msg = JSON.parse(line);
    if (msg.id && requests.has(msg.id)) {
      requests.get(msg.id)(msg);
      requests.delete(msg.id);
    } else {
      // console.log('Event:', msg);
    }
  } catch (e) {
    console.error('Failed to parse:', line);
  }
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
    // console.log('Sending:', req);
    mcp.stdin.write(req + '\n');
  });
}

async function run() {
  // Wait for initialization
  const initRes = await sendRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" }
  });
  console.log("Initialized.");
  await sendRequest("notifications/initialized");

  const listToolsRes = await sendRequest("tools/list");
  console.log("Available tools:");
  listToolsRes.result.tools.forEach(t => console.log(`- ${t.name}`));

  // Let's call the performance tool
  // The tool might be called "chrome_performance_get_metrics" or "chrome_performance_metrics"
  // Let's just find the performance related ones
  const perfTool = listToolsRes.result.tools.find(t => t.name.includes("performance"));
  if (perfTool) {
    console.log(`Calling ${perfTool.name}...`);
    const perfRes = await sendRequest("tools/call", {
      name: perfTool.name,
      arguments: { url: "http://localhost:5183/" } // The app URL
    });
    console.log("Performance Result:", JSON.stringify(perfRes, null, 2));
  } else {
    // If not found, just use the first performance tool
    const tools = listToolsRes.result.tools.filter(t => t.name.includes("performance") || t.name.includes("metrics"));
    console.log("Tools found:", tools.map(t => t.name));
  }
  
  process.exit(0);
}

setTimeout(run, 1000);
