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
  console.log("Connected to MCP. Will click through projects...");

  const projects = ["Intercom Website", "Intercom Mobile React Native", "RadonPreviewSmokeTest"];

  for (let p of projects) {
    console.log(`\\n--- Clicking project: ${p} ---`);
    await client.callTool({
      name: "evaluate_script",
      arguments: {
        function: `
          () => {
            const els = Array.from(document.querySelectorAll('span'));
            const match = els.find(el => el.textContent === '${p}');
            if (match && match.parentElement && match.parentElement.parentElement) {
              match.parentElement.parentElement.click();
              return true;
            }
            return false;
          }
        `
      }
    });

    await new Promise(r => setTimeout(r, 4000));

    const stateResult = await client.callTool({
      name: "evaluate_script",
      arguments: {
        function: `
          () => {
            let store = localStorage.getItem('cozea:project-workbench');
            let parsed = store ? JSON.parse(store) : null;
            let paths = {};
            if (parsed && parsed.state && parsed.state.workbenches) {
              for (const [key, wb] of Object.entries(parsed.state.workbenches)) {
                paths[key] = wb.projectPath || 'unbound';
              }
            }
            return { url: window.location.href, paths };
          }
        `
      }
    });

    let stateText = stateResult.content.find((c: any) => c.type === 'text')?.text || '';
    let match = stateText.match(/```json\\n([\\s\\S]*?)\\n```/);
    console.log(match ? JSON.stringify(JSON.parse(match[1]), null, 2) : stateText);
  }

  await transport.close();
}

main().catch(console.error);
