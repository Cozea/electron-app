import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs";
import path from "node:path";

const outputPath = path.resolve(import.meta.dir, "../../../scratch/diagnostics/mcp/page-text-dump.txt");

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

  const projectsResult = await client.callTool({
    name: "evaluate_script",
    arguments: {
      function: `
        () => {
          return document.body.innerText;
        }
      `
    }
  });

  let resultText = projectsResult.content.find((c: any) => c.type === 'text')?.text || '';
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, resultText);
  console.log(`Dumped text to ${outputPath}`);

  await transport.close();
}

main().catch(console.error);
