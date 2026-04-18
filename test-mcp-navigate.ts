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

  // 1. List available pages
  console.log("\\n--- Listing Pages ---");
  const pagesResult = await client.callTool({
    name: "list_pages",
    arguments: {}
  });
  console.log(JSON.stringify(pagesResult, null, 2));

  // 2. We'll navigate the current page using the navigate_page tool
  console.log("\\n--- Navigating using navigate_page ---");
  const navResult = await client.callTool({
    name: "navigate_page",
    arguments: {
      url: "http://localhost:5183/"
    }
  });
  console.log(JSON.stringify(navResult, null, 2));

  // 3. Wait a moment then get the title and URL
  console.log("\\n--- Checking new page state ---");
  await new Promise(r => setTimeout(r, 1000));
  const stateResult = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        () => {
          return {
            url: window.location.href,
            title: document.title,
            bodyLength: document.body.innerHTML.length
          };
        }
      `
    }
  });
  console.log(JSON.stringify(stateResult, null, 2));

  await transport.close();
}

main().catch(console.error);
