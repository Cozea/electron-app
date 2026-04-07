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

  console.log("Running Lighthouse audit on the app...");
  const auditRes = await sendRequest("tools/call", {
    name: "lighthouse_audit",
    arguments: { 
      mode: "navigation",
      device: "desktop"
    }
  });

  if (auditRes.result && auditRes.result.content) {
    console.log(auditRes.result.content[0].text);
  } else {
    console.log("Result:", JSON.stringify(auditRes, null, 2));
  }

  process.exit(0);
}

setTimeout(run, 1000);
