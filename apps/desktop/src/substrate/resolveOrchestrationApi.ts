import type { NativeApi } from "@cozea/assistant-contracts";

import { ensureNativeApi } from "@/lib/nativeApi";

/** Prefer T3 orchestration RPC when Phase T3 cutover is active. */
export function resolveOrchestrationApi(
  t3Orchestration: NativeApi["orchestration"] | null | undefined,
): NativeApi["orchestration"] {
  if (t3Orchestration) {
    return t3Orchestration;
  }
  return ensureNativeApi().orchestration;
}
