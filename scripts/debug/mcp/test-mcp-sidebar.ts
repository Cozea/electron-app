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
  console.log("Connected to MCP. Scanning current page for clickable elements...");

  // Navigate to root which automatically redirects to the active project and shows the sidebar
  await client.callTool({
    name: "navigate_page",
    arguments: { url: "http://localhost:5183/" }
  });
  
  // Wait for the route to settle and render the sidebar
  await new Promise(r => setTimeout(r, 4000));

  const projectsResult = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        () => {
          const elements = Array.from(document.querySelectorAll('span'));
          const matching = elements.filter(el => {
            const txt = (el.textContent || '').trim();
            return txt === 'Intercom Website' || txt === 'Intercom Mobile React Native' || txt === 'RadonPreviewSmokeTest';
          });
          
          return matching.map((span, i) => {
            const tempId = 'mcp-project-link-' + i;
            // The clickable element is likely a parent div
            let clickable = span;
            if (span.parentElement && span.parentElement.parentElement) {
              clickable = span.parentElement.parentElement;
            }
            clickable.id = tempId;
            return { id: tempId, text: (span.textContent || '').trim() };
          });
        }
          
          return projectElements.map((el, i) => {
            const tempId = 'mcp-project-link-' + i;
            el.id = tempId;
            return { id: tempId, text: (el.innerText || '').trim() };
          });
        }
      `
    }
  });

  let resultText = projectsResult.content.find((c: any) => c.type === 'text')?.text || '';
  let jsonMatch = resultText.match(/```json\\n([\\s\\S]*?)\\n```/);
  let projects = jsonMatch ? JSON.parse(jsonMatch[1]) : [];
  
  // Deduplicate by text
  const uniqueProjects = [];
  const seenTexts = new Set();
  for (const p of projects) {
    if (!seenTexts.has(p.text)) {
      seenTexts.add(p.text);
      uniqueProjects.push(p);
    }
  }

  console.log(`Found ${uniqueProjects.length} projects in the sidebar:`);
  uniqueProjects.forEach((p: any) => console.log(` - ${p.text}`));

  if (uniqueProjects.length < 2) {
    console.log("Could not find at least 2 projects in the sidebar to switch between.");
    await transport.close();
    return;
  }

  for (let i = 0; i < Math.min(uniqueProjects.length, 3); i++) {
    const proj = uniqueProjects[i];
    console.log(`\\n>>> Switching to project: ${proj.text} <<<`);
    
    await client.callTool({
      name: "evaluate_script",
      arguments: {
        function: `
          () => {
            // Click the element and its parent just to be safe
            const el = document.getElementById('${proj.id}');
            if (el) {
              el.click();
              if (el.parentElement) el.parentElement.click();
            }
            return true;
          }
        `
      }
    });

    // Wait for the route to change
    await new Promise(r => setTimeout(r, 4000));

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

    let stateText = stateResult.content.find((c: any) => c.type === 'text')?.text || '';
    let stateMatch = stateText.match(/```json\\n([\\s\\S]*?)\\n```/);
    let state = stateMatch ? JSON.parse(stateMatch[1]) : {};

    console.log(`Current App URL: ${state.currentUrl}`);
    console.log("Cached Workbench Paths:");
    console.log(JSON.stringify(state.workbenchPaths, null, 2));
  }

  await transport.close();
  console.log("\\nTest complete!");
}

main().catch(console.error);
