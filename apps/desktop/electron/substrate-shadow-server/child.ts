/**
 * Shadow server child — thin entry delegating to `@cozea/server`.
 */
import { bootstrapCozeaSubstrateServer } from "../../../../apps/server/src/bootstrap.ts";

let stopping = false;
let serverHandle: Awaited<ReturnType<typeof bootstrapCozeaSubstrateServer>> | null = null;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[substrate-shadow] shutting down (${signal})`);
  try {
    if (serverHandle) {
      await serverHandle.stop();
    }
  } catch {}
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

const bootstrapPromise = bootstrapCozeaSubstrateServer({
  onLog: (line) => console.log(line.replace("[cozea-server]", "[substrate-shadow]")),
});

bootstrapPromise
  .then((handle) => {
    serverHandle = handle;
  })
  .catch((error: unknown) => {
    console.error(
      `[substrate-shadow] failed to start: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
