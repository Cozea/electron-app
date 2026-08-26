import { waitForHttpReady } from "../backendReadiness";
import {
  ASSISTANT_RUNTIME_READINESS_PATH,
  DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN,
} from "./constants";

export interface ShadowHostedRuntimeMonitorOptions {
  readonly httpOrigin?: string;
  readonly readinessPath?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onLog?: (event: string, details?: Record<string, unknown>) => void;
  readonly shouldContinue?: () => boolean;
}

const DEFAULT_SHADOW_RUNTIME_READY_TIMEOUT_MS = 90_000;

/**
 * Poll the assistant runtime HTTP readiness endpoint when the runtime is hosted
 * by the substrate shadow child (primary mode) instead of Electron main.
 */
export async function waitForShadowHostedAssistantRuntimeReady(
  options: ShadowHostedRuntimeMonitorOptions = {},
): Promise<void> {
  const httpOrigin =
    options.httpOrigin?.trim() ||
    process.env.COZEA_ASSISTANT_RUNTIME_HTTP_ORIGIN?.trim() ||
    DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN;
  const readinessPath = options.readinessPath ?? ASSISTANT_RUNTIME_READINESS_PATH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SHADOW_RUNTIME_READY_TIMEOUT_MS;

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
}): ShadowHostedRuntimeMonitorController {
  let cancelled = false;

  input.onStarting();

  void (async () => {
    try {
      await waitForShadowHostedAssistantRuntimeReady({
        httpOrigin: input.httpOrigin,
        timeoutMs: input.timeoutMs,
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
