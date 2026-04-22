import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "bunx",
    args: ["chrome-devtools-mcp@latest", "--browser-url=http://127.0.0.1:9222"]
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  await client.connect(transport);
  console.log("Connected to MCP. Verifying current state of local storage...");

  const verifyResult = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        () => {
          try {
            let store = localStorage.getItem('cozea:project-workbench');
            let parsed = store ? JSON.parse(store) : null;
            
            let currentPaths = {};
            if (parsed && parsed.state && parsed.state.workbenches) {
              for (const [key, wb] of Object.entries(parsed.state.workbenches)) {
                currentPaths[key] = wb.projectPath || 'unbound';
              }
            }

            return currentPaths;
          } catch (e) {
            return { error: e.message };
          }
        }
      `
    }
  });

  let resultText = verifyResult.content.find((c: any) => c.type === 'text')?.text || '';
  let match = resultText.match(/```json\n([\s\S]*?)\n```/);
  const data = match ? JSON.parse(match[1]) : resultText;

  console.log("\n--- Remaining Workbench Paths in Cache ---");
  console.log(JSON.stringify(data, null, 2));

  const hasT3 = JSON.stringify(data).includes("t3code");
  console.log(`\nDoes 't3code' still exist anywhere in the cache? ${hasT3 ? "⚠️ YES" : "✅ NO"}`);

  await transport.close();
}

main().catch(console.error);
