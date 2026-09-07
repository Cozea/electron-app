import path from "node:path";
import { isWithinNativeWorkspace, type NativeWorkspaceDecision } from "../../../../shared/nativeWorkspaceAuthority";
import { isNativeWorkspaceAuthorizeRequest, requestNativeWorkspaceControl, sendNativeWorkspaceMessage, type NativeWorkspaceAuthorizeRequest, type NativeWorkspaceEndpoint } from "../../../../shared/nativeWorkspaceIpc";

const endpoints = new Set<NativeWorkspaceEndpoint>();
const suspended = new Set<string>();
let authorizer: ((request: NativeWorkspaceAuthorizeRequest) => Promise<NativeWorkspaceDecision>) | null = null;

export function setNativeWorkspaceAuthorizer(next: (request: NativeWorkspaceAuthorizeRequest) => Promise<NativeWorkspaceDecision>): () => void {
  if (authorizer && authorizer !== next) throw new Error("Native workspace authority is already registered.");
  authorizer = next;
  return () => { if (authorizer === next) authorizer = null; };
}

function isSuspended(cwd: string): boolean {
  for (const root of suspended) if (isWithinNativeWorkspace(root, cwd)) return true;
  return false;
}

/** Reserve the path before creating a session worktree or stopping its writers. */
export function blockNativeWorkspaceRoot(root: string): void {
  if (!path.isAbsolute(root) || root.includes("\0")) throw new Error("A catalog-owned native workspace is required.");
  if (!suspended.has(root) && suspended.size >= 4_096) throw new Error("Native workspace authority capacity reached; restart safely.");
  suspended.add(path.normalize(root));
}

/** Register every owned shadow child, including pool children and startup races. */
export function trackNativeWorkspaceEndpoint(endpoint: NativeWorkspaceEndpoint): () => void {
  endpoints.add(endpoint);
  let requests = 0;
  const onMessage = (value: unknown) => {
    if (!isNativeWorkspaceAuthorizeRequest(value)) return;
    const reply = (decision: NativeWorkspaceDecision) => sendNativeWorkspaceMessage(endpoint, {
      type: "cozea:workspace-authorize-result", requestId: value.requestId, ...decision,
    });
    if (!authorizer || isSuspended(value.cwd) || requests >= 128) { reply({ allowed: false, sessionRoot: null }); return; }
    requests++;
    void authorizer(value).then(decision => {
      // A catalog or gateway lookup may have been waiting when Leave reserved
      // the root. Recheck after it returns; the old allow cannot cross this fence.
      reply(isSuspended(value.cwd) ? { ...decision, allowed: false } : decision);
    }, () => reply({ allowed: false, sessionRoot: null })).finally(() => { requests--; });
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    endpoints.delete(endpoint);
    endpoint.off("message", onMessage);
    endpoint.off("exit", dispose);
  };
  endpoint.on("message", onMessage);
  endpoint.on("exit", dispose);
  return dispose;
}

async function control(root: string, action: "stop" | "activate"): Promise<void> {
  // A disconnected but not exited child is an unconfirmed owner, not success.
  const targets = [...endpoints];
  const results = await Promise.allSettled(targets.map(endpoint => requestNativeWorkspaceControl(endpoint, action, root)));
  if (results.some(result => result.status === "rejected")) throw new Error("A native chat server did not acknowledge workspace control; retry the operation.");
}

export async function stopNativeWorkspaceRoot(root: string): Promise<void> {
  blockNativeWorkspaceRoot(root);
  await control(root, "stop");
}

/** Called only after the coordinator has revalidated and activated the binding. */
export async function activateNativeWorkspaceRoot(root: string): Promise<void> {
  const normalized = path.normalize(root);
  await control(normalized, "activate");
  suspended.delete(normalized);
}
