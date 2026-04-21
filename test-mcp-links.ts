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

  // Navigate to root
  await client.callTool({
    name: "navigate_page",
    arguments: { url: "http://localhost:5183/projects" }
  });
  
  await new Promise(r => setTimeout(r, 4000));

  const clickResult = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        () => {
          // Find the list of projects and return their names or texts
          const projectCards = Array.from(document.querySelectorAll('a'))
            .map(a => ({ href: a.href, text: a.innerText }));
          return projectCards;
        }
      `
    }
  });

  console.log("All Links on page:");
  console.log(clickResult.content[0].text);

  await transport.close();
}

main().catch(console.error);
