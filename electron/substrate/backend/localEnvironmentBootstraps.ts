import type { DesktopEnvironmentBootstrap } from "@cozea/contracts";

import type { DesktopBackendPool } from "./DesktopBackendPool";
import { PRIMARY_BACKEND_INSTANCE_ID } from "./types";

export function listLocalEnvironmentBootstraps(
  pool: DesktopBackendPool,
): ReadonlyArray<DesktopEnvironmentBootstrap> {
  return pool.listDescriptors().flatMap((descriptor) => {
    const manager = pool.getManager(descriptor.id);
    const status = manager?.getStatus();
    if (!status || status.phase !== "ready") {
      return [];
    }
    const httpBaseUrl = `http://${descriptor.host}:${descriptor.port}`;
    return [
      {
        id: descriptor.id,
        label: descriptor.label,
        runningDistro: descriptor.wslDistro ?? null,
        httpBaseUrl,
        wsBaseUrl: `${httpBaseUrl.replace(/^http/i, "ws")}/rpc`,
      } satisfies DesktopEnvironmentBootstrap,
    ];
  });
}

export function isPrimaryBackendInstanceId(id: string): boolean {
  return id === PRIMARY_BACKEND_INSTANCE_ID;
}
