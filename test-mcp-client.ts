import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.log("Starting MCP client...");
  
  const transport = new StdioClientTransport({
    command: "bunx",
    args: ["chrome-devtools-mcp@latest", "--browser-url=http://127.0.0.1:9222"]
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  await client.connect(transport);
  console.log("Connected to MCP server!");

  console.log("Evaluating script to check active paths...");
  const result = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        () => {
          try {
            // Get local storage
            let store = localStorage.getItem('cozea-project-workbench-store');
            let parsed = store ? JSON.parse(store) : null;
            
            // Look for workbenches and their paths
            let workbenchPaths = {};
            if (parsed && parsed.state && parsed.state.workbenches) {
              for (const [key, wb] of Object.entries(parsed.state.workbenches)) {
                workbenchPaths[key] = wb.projectPath || 'unbound';
              }
            }

            return {
              currentUrl: window.location.href,
              workbenchPaths: workbenchPaths
            };
          } catch (e) {
            return { error: e.message };
          }
        }
      `
    }
  });

  console.log("Result:");
  console.log(JSON.stringify(result, null, 2));

  await transport.close();
}

main().catch(console.error);