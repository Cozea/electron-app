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
  console.log("Connected. Getting project IDs from the React/DOM state...");

  // Navigate to root to ensure data is loaded
  await client.callTool({
    name: "navigate_page",
    arguments: { url: "http://localhost:5183/" }
  });
  await new Promise(r => setTimeout(r, 2000));

  // Extract links more aggressively
  const linksResult = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        () => {
          // Find all elements that might contain a project ID
          // The route looks like /projects/p/:id/workbench
          let projectIds = new Set();
          
          // Strategy 1: Look at all links
          document.querySelectorAll('a').forEach(a => {
            const match = a.href.match(/\\/projects\\/p\\/([^\\/]+)/);
            if (match) projectIds.add(match[1]);
          });

          // Strategy 2: Look at local storage caches (e.g. Convex cache, or react-query)
          for (let i = 0; i < localStorage.length; i++) {
            try {
              let key = localStorage.key(i);
              let val = localStorage.getItem(key);
              if (val.includes('/projects/p/')) {
                // regex extract
                let matches = [...val.matchAll(/\\/projects\\/p\\/([^\\/"']+)/g)];
                matches.forEach(m => projectIds.add(m[1]));
              }
            } catch(e) {}
          }

          return Array.from(projectIds);
        }
      `
    }
  });

  let resultText = linksResult.content[0].text;
  let jsonMatch = resultText.match(/```json\\n([\\s\\S]*?)\\n```/);
  let projectIds = jsonMatch ? JSON.parse(jsonMatch[1]) : [];
  
  console.log("Found Project IDs:", projectIds);

  if (projectIds.length < 2) {
    console.log("Not enough projects found automatically. Using fallback project IDs if available, or stopping.");
    // Fallback based on your previous logs: m579z110tz8barz07p8e5pxhzn84za1h
    if (!projectIds.includes("m579z110tz8barz07p8e5pxhzn84za1h")) {
      projectIds.push("m579z110tz8barz07p8e5pxhzn84za1h");
    }
    if (projectIds.length < 2) {
      await transport.close();
      return;
    }
  }

  // Visit the first two projects
  for (let i = 0; i < 2; i++) {
    const pId = projectIds[i];
    const url = `http://localhost:5183/projects/p/${pId}/workbench`;
    console.log(`\\n--- Navigating to Project ${i + 1}: ${url} ---`);
    
    await client.callTool({
      name: "navigate_page",
      arguments: { url }
    });
    
    // Wait for the route to settle and store to update
    await new Promise(r => setTimeout(r, 2000));
    
    const stateResult = await client.callTool({
      name: "evaluate_script",
      arguments: {
        function: `
          () => {
            let store = localStorage.getItem('cozea-project-workbench-store');
            let parsed = store ? JSON.parse(store) : null;
            
            let workbenchPaths = {};
            if (parsed && parsed.state && parsed.state.workbenches) {
              for (const [key, wb] of Object.entries(parsed.state.workbenches)) {
                workbenchPaths[key] = wb.projectPath || 'unbound';
              }
            }
            return workbenchPaths;
          }
        `
      }
    });
    
    let stateText = stateResult.content[0].text;
    console.log(`State after visiting Project ${i + 1}:`);
    console.log(stateText);
  }

  await transport.close();
}

main().catch(console.error);
