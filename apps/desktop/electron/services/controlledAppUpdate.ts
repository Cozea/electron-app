import { randomUUID } from "node:crypto";
import type { HostUpdateRequest } from "../../../../shared/hostUpdateControl";
interface UpdateHost {
  controlUpdate(request: HostUpdateRequest): Promise<void>;
}
export function createControlledAppUpdateInstaller(deps: {
  isDownloaded(): boolean;
  getHosts(): ReadonlyArray<UpdateHost>;
  install(): void | Promise<void>;
}) {
  let inFlight: Promise<void> | undefined;
  return (continueActiveChats = false): Promise<void> => {
    if (inFlight) return inFlight;
    const run = async () => {
      if (!deps.isDownloaded()) throw new Error("Download the update before restarting Cozea.");
      const requestId = randomUUID();
      const hosts = continueActiveChats ? deps.getHosts() : [];
      try {
        const prepared = await Promise.allSettled(
          hosts.map((host) =>
            host.controlUpdate({ type: "cozea:host-update", action: "prepare", requestId }),
          ),
        );
        if (prepared.some((result) => result.status === "rejected"))
          throw new Error(
            "Active chats could not be prepared. Reconnect the chat server and retry the update.",
          );
        await deps.install();
      } catch (error) {
        const canceled = await Promise.allSettled(
          hosts.map((host) =>
            host.controlUpdate({ type: "cozea:host-update", action: "cancel", requestId }),
          ),
        );
        if (canceled.some((result) => result.status === "rejected"))
          throw new Error(
            "Update stopped. Chat continuation cleanup could not be acknowledged; reconnect before retrying.",
          );
        throw error;
      }
    };
    inFlight = run().catch((error: unknown) => {
      inFlight = undefined;
      throw error;
    });
    return inFlight;
  };
}
