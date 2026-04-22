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
  console.log("Connected to MCP. Cleaning up 't3code' paths from local storage...");

  const cleanResult = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        async () => {
          try {
            if (window.electron && window.electron.ipcRenderer) {
              try {
                await window.electron.ipcRenderer.invoke('terminal:killAll', {});
              } catch(e) {}
            }

            let removedKeys = [];
            
            // Clean specific store
            let store = localStorage.getItem('cozea:project-workbench');
            if (store) {
              let parsed = JSON.parse(store);
              if (parsed && parsed.state && parsed.state.workbenches) {
                const keys = Object.keys(parsed.state.workbenches);
                let modified = false;
                for (const key of keys) {
                  const wb = parsed.state.workbenches[key];
                  const path = wb.projectPath || '';
                  if (key.includes('t3code') || path.includes('t3code')) {
                    removedKeys.push('workbench:' + key);
                    delete parsed.state.workbenches[key];
                    modified = true;
                  }
                }
                if (modified) {
                  localStorage.setItem('cozea:project-workbench', JSON.stringify(parsed));
                }
              }
            }

            // Remove any other keys containing t3code
            const lsKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
              lsKeys.push(localStorage.key(i));
            }
            
            for (const key of lsKeys) {
              if (key.includes('t3code')) {
                localStorage.removeItem(key);
                removedKeys.push('ls:' + key);
              }
            }

            // Also clean up navigation so we don't boot back into the broken state
            localStorage.removeItem('cozea.lastWorkbenchRoute.v1');
            localStorage.removeItem('cozea-workbench-navigation');

            if (removedKeys.length > 0) {
              // Navigate away to the root projects page so no workbench is mounted
              window.history.pushState({}, '', '/projects');
              window.location.href = '/projects';
            }
            
            return { removedKeys, totalRemoved: removedKeys.length, reloaded: removedKeys.length > 0 };
          } catch (e) {
            return { error: e.message };
          }
        }
      `
    }
  });

  let resultText = cleanResult.content.find((c: any) => c.type === 'text')?.text || '';
  let match = resultText.match(/```json\n([\s\S]*?)\n```/);
  console.log("Result of cleanup:");
  console.log(match ? JSON.stringify(JSON.parse(match[1]), null, 2) : resultText);

  await transport.close();
}

main().catch(console.error);
