import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.log("Starting MCP observer...");
  
  const transport = new StdioClientTransport({
    command: "bunx",
    args: ["chrome-devtools-mcp@latest", "--browser-url=http://127.0.0.1:9222"]
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  await client.connect(transport);
  console.log("Connected to MCP server! Observing workbench store...");
  console.log("👉 Go ahead and switch between your projects in the Electron App.");
  console.log("   I will poll the runtime state every 3 seconds to see if the paths are distinct.\\n");

  // Loop indefinitely, polling the local storage state
  for (let i = 0; i < 20; i++) {
    const stateResult = await client.callTool({
      name: "evaluate_script",
      arguments: {
        function: `
          () => {
            try {
              let store = localStorage.getItem('cozea-project-workbench-store');
              let parsed = store ? JSON.parse(store) : null;
              
              let workbenchPaths = {};
              if (parsed && parsed.state && parsed.state.workbenches) {
                for (const [key, wb] of Object.entries(parsed.state.workbenches)) {
                  // The key itself is the path-aware scope key, let's extract the projectPath
                  workbenchPaths[key] = wb.projectPath || 'unbound';
                }
              }

              return {
                currentUrl: window.location.pathname,
                workbenchPaths
              };
            } catch (e) {
              return { error: e.message };
            }
          }
        `
      }
    });

    let resultText = stateResult.content[0].text;
    let jsonMatch = resultText.match(/```json\\n([\\s\\S]*?)\\n```/);
    let state = jsonMatch ? JSON.parse(jsonMatch[1]) : {};
    
    console.log(`[Polling ${i + 1}/20] Current URL: ${state.currentUrl}`);
    if (Object.keys(state.workbenchPaths || {}).length > 0) {
      console.log("Active Workbench Paths in State:", state.workbenchPaths);
    } else {
      console.log("No workbench paths initialized yet. Open a terminal or dev server in a project.");
    }
    console.log("---------------------------------------------------");

    await new Promise(r => setTimeout(r, 3000));
  }

  await transport.close();
}

main().catch(console.error);
