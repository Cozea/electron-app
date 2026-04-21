import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.log("Starting MCP client for Project Switching Test...");
  
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

  // 1. Navigate to the projects dashboard
  console.log("\\n--- Navigating to /projects ---");
  await client.callTool({
    name: "navigate_page",
    arguments: { url: "http://localhost:5183/projects" }
  });
  
  await new Promise(r => setTimeout(r, 1000));

  // 2. Get list of project URLs from the DOM
  console.log("\\n--- Extracting Project Links ---");
  const linksResult = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        () => {
          return document.body.innerHTML.substring(0, 500); // just grab first 500 chars to see what's rendering
        }
      `
    }
  });
  
  let resultText = linksResult.content[0].text;
  console.log("Raw evaluate_script result:");
  console.log(resultText);
  
  let jsonMatch = resultText.match(/```json\\n([\\s\\S]*?)\\n```/);
  let projectLinks = jsonMatch ? JSON.parse(jsonMatch[1]) : [];
  
  console.log(`Found ${projectLinks.length} projects:`, projectLinks);

  if (projectLinks.length < 2) {
    console.log("Not enough projects to test switching. Please create at least 2 projects in the app.");
    await transport.close();
    return;
  }

  // 3. Visit first two projects and check local storage
  for (let i = 0; i < 2; i++) {
    const url = projectLinks[i];
    console.log(`\\n--- Navigating to Project ${i + 1}: ${url} ---`);
    
    await client.callTool({
      name: "navigate_page",
      arguments: { url }
    });
    
    await new Promise(r => setTimeout(r, 2000)); // wait for workbench to load
    
    const stateResult = await client.callTool({
      name: "evaluate_script",
      arguments: {
        function: `
          () => {
            try {
              let store = localStorage.getItem('cozea-project-workbench-store');
              let parsed = store ? JSON.parse(store) : null;
              
              let workbenchPaths = {};
              let workbenchIds = {};
              if (parsed && parsed.state && parsed.state.workbenches) {
                for (const [key, wb] of Object.entries(parsed.state.workbenches)) {
                  workbenchPaths[key] = wb.projectPath || 'unbound';
                  workbenchIds[key] = wb.projectId;
                }
              }

              return {
                currentUrl: window.location.href,
                workbenchPaths,
                workbenchIds
              };
            } catch (e) {
              return { error: e.message };
            }
          }
        `
      }
    });
    
    console.log(`Project ${i + 1} State:`);
    console.log(stateResult.content[0].text);
  }

  await transport.close();
}

main().catch(console.error);
