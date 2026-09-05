interface HostUpdateChild {
  readonly connected: boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "exit", listener: () => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "exit", listener: () => void): unknown;
  send(message: object, callback: (error: Error | null) => void): unknown;
}
export interface HostUpdateRequest {
  type: "cozea:host-update";
  action: "prepare" | "cancel";
  requestId: string;
}
export function isHostUpdateRequest(value: unknown): value is HostUpdateRequest {
  if (!value || typeof value !== "object") return false;
  return (
    "type" in value &&
    value.type === "cozea:host-update" &&
    "action" in value &&
    (value.action === "prepare" || value.action === "cancel") &&
    "requestId" in value &&
    typeof value.requestId === "string" &&
    /^[a-zA-Z0-9-]{1,80}$/.test(value.requestId)
  );
}
export function requestHostUpdate(
  child: HostUpdateChild,
  request: HostUpdateRequest,
  timeoutMs = 10_000,
): Promise<void> {
  if (!child.connected)
    return Promise.reject(
      new Error("The chat server is disconnected. Retry the update after reconnecting."),
    );
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const onExit = () =>
      finish(new Error("The chat server stopped before acknowledging update preparation."));
    const onMessage = (value: unknown) => {
      if (
        !value ||
        typeof value !== "object" ||
        !("type" in value) ||
        value.type !== "cozea:host-update-result" ||
        !("requestId" in value) ||
        value.requestId !== request.requestId ||
        !("action" in value) ||
        value.action !== request.action
      )
        return;
      finish(
        "success" in value && value.success === true
          ? undefined
          : new Error("The chat server could not prepare or cancel update continuation."),
      );
    };
    const timer = setTimeout(
      () => finish(new Error("Timed out preparing active chats for the update.")),
      timeoutMs,
    );
    child.on("message", onMessage);
    child.on("exit", onExit);
    try {
      child.send(request, (error) => {
        if (error) finish(error);
      });
    } catch {
      finish(new Error("The chat server disconnected during update preparation."));
    }
  });
}
