import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const client = new ConvexHttpClient(process.env.CONVEX_URL || "https://knowing-finch-546.convex.cloud");

async function run() {
  try {
    // We just need any valid project and user ID. We can try to list projects if we can.
    // Or we can just call it with invalid IDs to see if it throws a schema error before executing.
    const result = await client.query("debug:ping");
    console.log("PING RESULT:", result);
  } catch (e) {
    console.error("ERROR:", e.message);
  }
}
run();