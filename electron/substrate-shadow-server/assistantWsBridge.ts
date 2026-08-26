import { randomUUID } from "node:crypto";

import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationEvent,
  type WsPush,
  WS_CHANNELS,
} from "@cozea/assistant-contracts";
import WebSocket from "ws";

import {
  DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN,
} from "../substrate/constants";

const DEFAULT_ASSISTANT_WS_URL = "ws://127.0.0.1:3773";
const DEFAULT_BRIDGE_TIMEOUT_MS = 60_000;

export interface BridgeAssistantTurnInput {
  readonly text: string;
  readonly threadId?: string;
  readonly providerId?: string;
  readonly assistantOrigin?: string;
  readonly assistantWsUrl?: string;
  readonly timeoutMs?: number;
  readonly cwd?: string;
  readonly WebSocketImpl?: typeof WebSocket;
}

export interface BridgeAssistantTurnResult {
  readonly replyText: string;
  readonly mode: "bridged";
}

interface WebSocketResponse {
  readonly id: string;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
}

function resolveAssistantWsUrl(input: BridgeAssistantTurnInput): string {
  const fromInput = input.assistantWsUrl?.trim();
  if (fromInput) {
    return fromInput;
  }
  const fromEnv = process.env.COZEA_ASSISTANT_RUNTIME_WS_URL?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const origin = input.assistantOrigin?.trim() || process.env.COZEA_ASSISTANT_RUNTIME_HTTP_ORIGIN?.trim();
  if (origin) {
    try {
      const parsed = new URL(origin);
      const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${parsed.host}`;
    } catch {
      // Fall through to default.
    }
  }
  return DEFAULT_ASSISTANT_WS_URL;
}

function isPushEnvelope(message: unknown): message is WsPush {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message as { type?: unknown }).type === "push"
  );
}

function asWebSocketResponse(message: unknown): WebSocketResponse | null {
  if (typeof message !== "object" || message === null || !("id" in message)) {
    return null;
  }
  const id = (message as { id?: unknown }).id;
  return typeof id === "string" ? (message as WebSocketResponse) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readThreadMessageSent(event: OrchestrationEvent): {
  readonly threadId: string;
  readonly messageId: string;
  readonly role: string;
  readonly text: string;
  readonly streaming: boolean;
} | null {
  if (event.type !== "thread.message-sent") {
    return null;
  }
  const payload = asRecord(event.payload);
  if (!payload) {
    return null;
  }
  const threadId = typeof payload.threadId === "string" ? payload.threadId : "";
  const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
  const role = typeof payload.role === "string" ? payload.role : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  const streaming = payload.streaming === true;
  if (!threadId || !messageId || !role) {
    return null;
  }
  return { threadId, messageId, role, text, streaming };
}

class AssistantWsBridgeClient {
  private readonly ws: WebSocket;
  private readonly pushQueue: WsPush[] = [];
  private readonly responseQueue: WebSocketResponse[] = [];
  private readonly pushWaiters: Array<(value: WsPush) => void> = [];
  private readonly responseWaiters: Array<(value: WebSocketResponse) => void> = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (isPushEnvelope(parsed)) {
        const waiter = this.pushWaiters.shift();
        if (waiter) {
          waiter(parsed);
        } else {
          this.pushQueue.push(parsed);
        }
        return;
      }
      const response = asWebSocketResponse(parsed);
      if (!response) {
        return;
      }
      const responseWaiter = this.responseWaiters.shift();
      if (responseWaiter) {
        responseWaiter(response);
      } else {
        this.responseQueue.push(response);
      }
    });
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }

  private dequeuePush(timeoutMs: number): Promise<WsPush> {
    const queued = this.pushQueue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pushWaiters.indexOf(resolve);
        if (index >= 0) {
          this.pushWaiters.splice(index, 1);
        }
        reject(new Error(`Timed out waiting for assistant push after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pushWaiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  private dequeueResponse(timeoutMs: number): Promise<WebSocketResponse> {
    const queued = this.responseQueue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.responseWaiters.indexOf(resolve);
        if (index >= 0) {
          this.responseWaiters.splice(index, 1);
        }
        reject(new Error(`Timed out waiting for assistant response after ${timeoutMs}ms`));
      }, timeoutMs);
      this.responseWaiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  async waitForWelcome(timeoutMs: number): Promise<Record<string, unknown>> {
    const push = await this.dequeuePush(timeoutMs);
    if (push.channel !== WS_CHANNELS.serverWelcome) {
      throw new Error(`Expected ${WS_CHANNELS.serverWelcome}, got ${push.channel}`);
    }
    const data = asRecord(push.data);
    return data ?? {};
  }

  async sendRequest(method: string, params: unknown, timeoutMs: number): Promise<WebSocketResponse> {
    const id = randomUUID();
    const body =
      method === ORCHESTRATION_WS_METHODS.dispatchCommand
        ? { _tag: method, command: params }
        : { _tag: method, ...(asRecord(params) ?? {}) };
    this.ws.send(JSON.stringify({ id, body }));

    while (true) {
      const response = await this.dequeueResponse(timeoutMs);
      if (response.id === id || response.id === "unknown") {
        return response;
      }
    }
  }

  async waitForDomainEvent(
    predicate: (event: OrchestrationEvent) => boolean,
    timeoutMs: number,
  ): Promise<OrchestrationEvent> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const push = await this.dequeuePush(remaining);
      if (push.channel !== ORCHESTRATION_WS_CHANNELS.domainEvent) {
        continue;
      }
      const event = push.data as OrchestrationEvent;
      if (predicate(event)) {
        return event;
      }
    }
    throw new Error("Timed out waiting for orchestration domain event");
  }
}

async function connectAssistantWs(
  wsUrl: string,
  WebSocketImpl: typeof WebSocket,
  timeoutMs: number,
): Promise<AssistantWsBridgeClient> {
  const token = process.env.COZEA_ASSISTANT_RUNTIME_TOKEN?.trim();
  const url = token ? `${wsUrl}${wsUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : wsUrl;

  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocketImpl(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Assistant WebSocket connect timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });

  return new AssistantWsBridgeClient(ws);
}

function resolveModelSelection(providerId: string | undefined): {
  readonly provider: "codex" | "opencode" | "claudeAgent" | "cursor";
  readonly model: string;
} {
  switch (providerId) {
    case "opencode":
      return { provider: "opencode", model: "opencode/default" };
    case "claudeAgent":
      return { provider: "claudeAgent", model: "claude-sonnet-4-20250514" };
    case "cursor":
      return { provider: "cursor", model: "cursor/default" };
    case "codex":
    default:
      return { provider: "codex", model: "gpt-5.3-codex" };
  }
}

async function ensureThreadId(
  client: AssistantWsBridgeClient,
  input: {
    readonly threadId?: string;
    readonly welcome: Record<string, unknown>;
    readonly cwd: string;
    readonly providerId?: string;
    readonly timeoutMs: number;
  },
): Promise<string> {
  if (input.threadId?.trim()) {
    return input.threadId.trim();
  }

  const welcomeThreadId =
    typeof input.welcome.bootstrapThreadId === "string"
      ? input.welcome.bootstrapThreadId.trim()
      : "";
  if (welcomeThreadId) {
    return welcomeThreadId;
  }

  const snapshotResponse = await client.sendRequest(
    ORCHESTRATION_WS_METHODS.getSnapshot,
    {},
    input.timeoutMs,
  );
  if (snapshotResponse.error) {
    throw new Error(snapshotResponse.error.message ?? "getSnapshot failed");
  }
  const snapshot = asRecord(snapshotResponse.result);
  const projects = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
  const threads = Array.isArray(snapshot?.threads) ? snapshot.threads : [];

  let projectId =
    typeof input.welcome.bootstrapProjectId === "string"
      ? input.welcome.bootstrapProjectId.trim()
      : "";
  if (!projectId) {
    const activeProject = projects.find((entry) => {
      const record = asRecord(entry);
      return record && record.deletedAt == null;
    });
    projectId =
      typeof asRecord(activeProject)?.id === "string"
        ? (asRecord(activeProject)?.id as string)
        : "";
  }

  const createdAt = new Date().toISOString();
  const modelSelection = resolveModelSelection(input.providerId);

  if (!projectId) {
    projectId = randomUUID();
    const createProject = await client.sendRequest(
      ORCHESTRATION_WS_METHODS.dispatchCommand,
      {
        type: "project.create",
        commandId: randomUUID(),
        projectId,
        title: "Substrate bridge",
        workspaceRoot: input.cwd,
        defaultModelSelection: modelSelection,
        createdAt,
      },
      input.timeoutMs,
    );
    if (createProject.error) {
      throw new Error(createProject.error.message ?? "project.create failed");
    }
  }

  const existingThread = threads.find((entry) => {
    const record = asRecord(entry);
    return record?.projectId === projectId && record.deletedAt == null;
  });
  const existingThreadId =
    typeof asRecord(existingThread)?.id === "string"
      ? (asRecord(existingThread)?.id as string)
      : "";
  if (existingThreadId) {
    return existingThreadId;
  }

  const threadId = randomUUID();
  const createThread = await client.sendRequest(
    ORCHESTRATION_WS_METHODS.dispatchCommand,
    {
      type: "thread.create",
      commandId: randomUUID(),
      threadId,
      projectId,
      title: "Substrate bridge",
      modelSelection,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt,
    },
    input.timeoutMs,
  );
  if (createThread.error) {
    throw new Error(createThread.error.message ?? "thread.create failed");
  }
  return threadId;
}

/**
 * Bridge one user turn through the assistant orchestration WebSocket.
 * Used by shadow `/rpc` when primary mode (or provider materialize failure)
 * needs real assistant replies instead of echo stubs.
 */
export async function bridgeAssistantTurn(
  input: BridgeAssistantTurnInput,
): Promise<BridgeAssistantTurnResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS;
  const wsUrl = resolveAssistantWsUrl(input);
  const WebSocketImpl = input.WebSocketImpl ?? WebSocket;
  const cwd = input.cwd?.trim() || process.cwd();

  const client = await connectAssistantWs(wsUrl, WebSocketImpl, timeoutMs);
  try {
    const welcome = await client.waitForWelcome(timeoutMs);
    const threadId = await ensureThreadId(client, {
      threadId: input.threadId,
      welcome,
      cwd,
      providerId: input.providerId,
      timeoutMs,
    });

    const createdAt = new Date().toISOString();
    const modelSelection = resolveModelSelection(input.providerId);
    const startTurn = await client.sendRequest(
      ORCHESTRATION_WS_METHODS.dispatchCommand,
      {
        type: "thread.turn.start",
        commandId: randomUUID(),
        threadId,
        message: {
          messageId: randomUUID(),
          role: "user",
          text: input.text,
          attachments: [],
        },
        modelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt,
      },
      timeoutMs,
    );
    if (startTurn.error) {
      throw new Error(startTurn.error.message ?? "thread.turn.start failed");
    }

    const assistantTexts = new Map<string, string>();
    let latestAssistantText = "";
    let turnCompleted = false;

    const deadline = Date.now() + timeoutMs;
    while (!turnCompleted && Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      try {
        const event = await client.waitForDomainEvent((candidate) => {
          if (candidate.type === "thread.session-set") {
            const payload = asRecord(candidate.payload);
            const session = asRecord(payload?.session);
            const status = typeof session?.status === "string" ? session.status : "";
            return (
              payload?.threadId === threadId &&
              (status === "completed" || status === "stopped" || status === "error")
            );
          }
          const message = readThreadMessageSent(candidate);
          return message?.threadId === threadId && message.role === "assistant";
        }, remaining);

        if (event.type === "thread.session-set") {
          turnCompleted = true;
          break;
        }

        const message = readThreadMessageSent(event);
        if (message) {
          assistantTexts.set(message.messageId, message.text);
          latestAssistantText = message.text;
          if (!message.streaming) {
            turnCompleted = true;
          }
        }
      } catch {
        break;
      }
    }

    const replyText =
      latestAssistantText.trim().length > 0
        ? latestAssistantText
        : Array.from(assistantTexts.values()).join("\n").trim();

    return {
      replyText: replyText.length > 0 ? replyText : `[substrate-bridge] turn accepted: ${input.text}`,
      mode: "bridged",
    };
  } finally {
    client.close();
  }
}

export { DEFAULT_ASSISTANT_WS_URL, DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN };
