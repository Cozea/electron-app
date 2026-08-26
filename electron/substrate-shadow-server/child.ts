/**
 * Shadow server child — thin entry delegating to `@cozea/server`.
 */
import { bootstrapCozeaSubstrateServer } from "../../apps/server/src/bootstrap.ts";

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[substrate-shadow] shutting down (${signal})`);
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

void bootstrapCozeaSubstrateServer({
  onLog: (line) => console.log(line.replace("[cozea-server]", "[substrate-shadow]")),
}).catch((error: unknown) => {
  console.error(
    `[substrate-shadow] failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
