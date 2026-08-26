import { waitForHttpReady } from "../backendReadiness";
import {
  ASSISTANT_RUNTIME_READINESS_PATH,
  DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN,
  SUBSTRATE_SHADOW_READY_PATH,
} from "./constants";

export interface ShadowHostedRuntimeMonitorOptions {
  readonly httpOrigin?: string;
  readonly readinessPath?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onLog?: (event: string, details?: Record<string, unknown>) => void;
  readonly shouldContinue?: () => boolean;
  /** When set, probe shadow ready payload for `t3Server: true` instead of legacy :3773. */
  readonly shadowBaseUrl?: string;
  readonly preferT3Server?: boolean;
}

const DEFAULT_SHADOW_RUNTIME_READY_TIMEOUT_MS = 90_000;

async function waitForShadowT3Ready(
  shadowBaseUrl: string,
  options: Pick<ShadowHostedRuntimeMonitorOptions, "timeoutMs" | "fetchImpl" | "shouldContinue">,
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_SHADOW_RUNTIME_READY_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;
  const readyUrl = new URL(SUBSTRATE_SHADOW_READY_PATH, shadowBaseUrl).toString();

  while (Date.now() < deadline) {
    if (options.shouldContinue?.() === false) {
      throw new Error("Shadow T3 readiness probe cancelled");
    }
    try {
      const response = await fetchImpl(readyUrl);
      if (response.ok) {
        const payload = (await response.json()) as { t3Server?: boolean };
        if (payload.t3Server === true) {
          return;
        }
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for T3 server at ${readyUrl}`);
}

/**
 * Poll the assistant runtime HTTP readiness endpoint when the runtime is hosted
 * by the substrate shadow child (primary mode) instead of Electron main.
 * When `preferT3Server` is true, waits for shadow ready payload `t3Server: true`.
 */
export async function waitForShadowHostedAssistantRuntimeReady(
  options: ShadowHostedRuntimeMonitorOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SHADOW_RUNTIME_READY_TIMEOUT_MS;

  if (options.preferT3Server && options.shadowBaseUrl) {
    options.onLog?.("shadow-hosted-t3-probe-start", {
      shadowBaseUrl: options.shadowBaseUrl,
      timeoutMs,
    });
    await waitForShadowT3Ready(options.shadowBaseUrl, {
      timeoutMs,
      fetchImpl: options.fetchImpl,
      shouldContinue: options.shouldContinue,
    });
    options.onLog?.("shadow-hosted-t3-probe-ready", {
      shadowBaseUrl: options.shadowBaseUrl,
    });
    return;
  }

  const httpOrigin =
    options.httpOrigin?.trim() ||
    process.env.COZEA_ASSISTANT_RUNTIME_HTTP_ORIGIN?.trim() ||
    DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN;
  const readinessPath = options.readinessPath ?? ASSISTANT_RUNTIME_READINESS_PATH;

  options.onLog?.("shadow-hosted-runtime-probe-start", { httpOrigin, readinessPath, timeoutMs });

  await waitForHttpReady(httpOrigin, {
    path: readinessPath,
    timeoutMs,
    fetchImpl: options.fetchImpl,
  });

  options.onLog?.("shadow-hosted-runtime-probe-ready", { httpOrigin });
}

export interface ShadowHostedRuntimeMonitorController {
  readonly generation: number;
  stop(): void;
}

/**
 * Start (or restart) monitoring shadow-hosted assistant runtime readiness.
 * Returns a controller that cancels in-flight probes when `stop()` is called.
 */
export function startShadowHostedRuntimeMonitor(input: {
  readonly generation: number;
  readonly onStarting: () => void;
  readonly onReady: () => void;
  readonly onError: (message: string) => void;
  readonly onLog?: (event: string, details?: Record<string, unknown>) => void;
  readonly shouldApply?: (generation: number) => boolean;
  readonly httpOrigin?: string;
  readonly timeoutMs?: number;
  readonly shadowBaseUrl?: string;
  readonly preferT3Server?: boolean;
}): ShadowHostedRuntimeMonitorController {
  let cancelled = false;

  input.onStarting();

  void (async () => {
    try {
      await waitForShadowHostedAssistantRuntimeReady({
        httpOrigin: input.httpOrigin,
        timeoutMs: input.timeoutMs,
        shadowBaseUrl: input.shadowBaseUrl,
        preferT3Server: input.preferT3Server,
        onLog: input.onLog,
        shouldContinue: () => !cancelled && (input.shouldApply?.(input.generation) ?? true),
      });
      if (cancelled || input.shouldApply?.(input.generation) === false) {
        return;
      }
      input.onReady();
    } catch (error) {
      if (cancelled || input.shouldApply?.(input.generation) === false) {
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : "Shadow-hosted assistant runtime failed to become ready.";
      input.onError(message);
    }
  })();

  return {
    generation: input.generation,
    stop() {
      cancelled = true;
    },
  };
}
