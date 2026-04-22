import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "fs";
import path from "node:path";

const outputPath = path.resolve(import.meta.dir, "../../../scratch/diagnostics/mcp/screenshot.png");

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

  const screenshotResult = await client.callTool({
    name: "take_screenshot",
    arguments: {}
  });

  // Extract base64 image data and save to file
  const resultText = screenshotResult.content.find((c: any) => c.type === 'text')?.text || '';
  const regex = new RegExp('data:image/(png|jpeg);base64,([a-zA-Z0-9+/=]+)');
  let imageMatch = resultText.match(regex);
  if (!imageMatch && screenshotResult.content.find((c: any) => c.type === 'image')) {
    const imgData = screenshotResult.content.find((c: any) => c.type === 'image');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(imgData.data, 'base64'));
    console.log(`Saved screenshot to ${outputPath}`);
    await transport.close();
    return;
  }
  
  if (imageMatch) {
    const base64Data = imageMatch[2];
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));
    console.log(`Saved screenshot to ${outputPath}`);
  } else {
    console.log("No screenshot found in response:", resultText.substring(0, 200));
  }

  await transport.close();
}

main().catch(console.error);
