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
  
  await client.callTool({
    name: "navigate_page",
    arguments: { url: "http://localhost:5183/" }
  });
  
  await new Promise(r => setTimeout(r, 4000));

  const debugResult = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        () => {
          const elements = Array.from(document.querySelectorAll('*'));
          const matching = elements.filter(el => (el.textContent || '').includes('Intercom Website'));
          
          return matching.map(el => ({
            tag: el.tagName,
            classes: el.className,
            id: el.id,
            text: (el.textContent || '').trim().substring(0, 30),
            childrenCount: el.children.length
          }));
        }
      `
    }
  });

  let resultText = debugResult.content.find((c: any) => c.type === 'text')?.text || '';
  console.log(resultText);

  await transport.close();
}

main().catch(console.error);
