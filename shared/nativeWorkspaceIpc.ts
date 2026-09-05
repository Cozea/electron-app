import { randomUUID } from "node:crypto";
import path from "node:path";
import type { NativeWorkspaceDecision, NativeWorkspaceOperation } from "./nativeWorkspaceAuthority";

export interface NativeWorkspaceAuthorizeRequest {
  readonly type: "cozea:workspace-authorize";
  readonly requestId: string;
  readonly cwd: string;
  readonly operation: NativeWorkspaceOperation;
}

export interface NativeWorkspaceAuthorizeResult extends NativeWorkspaceDecision {
  readonly type: "cozea:workspace-authorize-result";
  readonly requestId: string;
}

export interface NativeWorkspaceControlRequest {
  readonly type: "cozea:workspace-control";
  readonly requestId: string;
  readonly action: "stop" | "activate";
  readonly root: string;
}

export interface NativeWorkspaceControlResult {
  readonly type: "cozea:workspace-control-result";
  readonly requestId: string;
  readonly action: "stop" | "activate";
  readonly success: boolean;
}

export type NativeWorkspaceMessage = NativeWorkspaceAuthorizeRequest | NativeWorkspaceAuthorizeResult | NativeWorkspaceControlRequest | NativeWorkspaceControlResult;

/** Inherited Node IPC only. Never expose this channel in renderer preload or WS. */
export interface NativeWorkspaceEndpoint {
  readonly connected?: boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  send?: (message: object, callback: (error: Error | null) => void) => unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 32_768 && !value.includes("\0") && path.isAbsolute(value);
}

export function isNativeWorkspaceAuthorizeRequest(value: unknown): value is NativeWorkspaceAuthorizeRequest {
  const row = record(value);
  return row?.type === "cozea:workspace-authorize" && validId(row.requestId) && validPath(row.cwd) && (row.operation === "execute" || row.operation === "git");
}

export function isNativeWorkspaceAuthorizeResult(value: unknown): value is NativeWorkspaceAuthorizeResult {
  const row = record(value);
  return row?.type === "cozea:workspace-authorize-result" && validId(row.requestId) && typeof row.allowed === "boolean" && (row.sessionRoot === null || validPath(row.sessionRoot));
}

export function isNativeWorkspaceControlRequest(value: unknown): value is NativeWorkspaceControlRequest {
  const row = record(value);
  return row?.type === "cozea:workspace-control" && validId(row.requestId) && validPath(row.root) && (row.action === "stop" || row.action === "activate");
}

export function isNativeWorkspaceControlResult(value: unknown): value is NativeWorkspaceControlResult {
  const row = record(value);
  return row?.type === "cozea:workspace-control-result" && validId(row.requestId) && typeof row.success === "boolean" && (row.action === "stop" || row.action === "activate");
}

export function sendNativeWorkspaceMessage(endpoint: NativeWorkspaceEndpoint, message: NativeWorkspaceMessage): void {
  if (!endpoint.connected || !endpoint.send) return;
  try { endpoint.send(message, () => undefined); }
  catch { /* Disconnect can race a response; the requester retains its deadline. */ }
}

const inflight = new WeakMap<NativeWorkspaceEndpoint, number>();

function request<Result>(
  endpoint: NativeWorkspaceEndpoint,
  message: NativeWorkspaceAuthorizeRequest | NativeWorkspaceControlRequest,
  accept: (value: unknown) => Result | null,
  timeoutMs: number,
): Promise<Result> {
  if (!endpoint.connected || !endpoint.send) return Promise.reject(new Error("Native workspace authority channel is unavailable."));
  const count = inflight.get(endpoint) ?? 0;
  if (count >= 128) return Promise.reject(new Error("Native workspace authority is busy; retry the operation."));
  inflight.set(endpoint, count + 1);
  return new Promise<Result>((resolve, reject) => {
    let finished = false;
    const finish = (result: Result | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      endpoint.off("message", onMessage);
      endpoint.off("disconnect", onLost);
      endpoint.off("exit", onLost);
      endpoint.off("error", onLost);
      const remaining = (inflight.get(endpoint) ?? 1) - 1;
      if (remaining > 0) inflight.set(endpoint, remaining); else inflight.delete(endpoint);
      if (result !== null) resolve(result);
      else reject(new Error("Native workspace authority did not acknowledge the request."));
    };
    const onMessage = (value: unknown) => {
      const result = accept(value);
      if (result !== null) finish(result);
    };
    const onLost = () => finish(null);
    const timer = setTimeout(onLost, timeoutMs);
    endpoint.on("message", onMessage);
    endpoint.on("disconnect", onLost);
    endpoint.on("exit", onLost);
    endpoint.on("error", onLost);
    try { endpoint.send!(message, error => { if (error) onLost(); }); }
    catch { onLost(); }
  });
}

export function requestNativeWorkspaceDecision(
  endpoint: NativeWorkspaceEndpoint,
  cwd: string,
  operation: NativeWorkspaceOperation,
): Promise<NativeWorkspaceDecision> {
  if (!validPath(cwd) || (operation !== "execute" && operation !== "git")) return Promise.reject(new Error("Invalid native workspace authorization request."));
  const message: NativeWorkspaceAuthorizeRequest = { type: "cozea:workspace-authorize", requestId: randomUUID(), cwd, operation };
  return request(endpoint, message, value => isNativeWorkspaceAuthorizeResult(value) && value.requestId === message.requestId ? value : null, 5_000);
}

export async function requestNativeWorkspaceControl(
  endpoint: NativeWorkspaceEndpoint,
  action: "stop" | "activate",
  root: string,
): Promise<void> {
  if (!validPath(root) || (action !== "stop" && action !== "activate")) throw new Error("Invalid native workspace control request.");
  const message: NativeWorkspaceControlRequest = { type: "cozea:workspace-control", requestId: randomUUID(), action, root };
  const result = await request(endpoint, message, value => isNativeWorkspaceControlResult(value) && value.requestId === message.requestId && value.action === action ? value : null, 30_000);
  if (!result.success) throw new Error("Native workspace control was not acknowledged; retry the operation.");
}
