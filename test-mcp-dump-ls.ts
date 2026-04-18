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

  const lsResult = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        () => {
          let keys = [];
          for (let i = 0; i < localStorage.length; i++) {
            keys.push(localStorage.key(i));
          }
          return keys;
        }
      `
    }
  });

  let resultText = lsResult.content.find((c: any) => c.type === 'text')?.text || '';
  console.log("LocalStorage Keys:", resultText);

  await transport.close();
}

main().catch(console.error);
