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
  console.log("Connected. Navigating to /projects...");

  await client.callTool({
    name: "navigate_page",
    arguments: { url: "http://localhost:5183/projects" }
  });
  
  // Wait for React to render the list
  await new Promise(r => setTimeout(r, 3000));

  const domResult = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        () => {
          // Find anything that looks like a project ID route
          const html = document.body.innerHTML;
          const matches = [...html.matchAll(/m[a-z0-9]{31}/g)];
          return Array.from(new Set(matches.map(m => m[0])));
        }
      `
    }
  });

  console.log("Convex IDs found in the DOM:");
  console.log(domResult.content[0].text);

  await transport.close();
}

main().catch(console.error);
