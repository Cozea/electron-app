import { useEffect } from "react";

import { useProblemsStore } from "@/stores/useProblemsStore";
import {
  DIAGNOSTICS_REFRESH_EVENT_NAME,
  requestEditorDiagnosticsRefresh,
} from "@/lib/editor/diagnosticsRefresh";

export { requestEditorDiagnosticsRefresh };

export function useDiagnosticsBridge(projectPath: string | null) {
  const replaceDiagnostics = useProblemsStore((state) => state.actions.replaceDiagnostics);

  useEffect(() => {
    if (!projectPath) {
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void import("@/hooks/useDiagnosticsBridgeRuntime")
      .then(({ createDiagnosticsBridgeRuntime }) =>
        createDiagnosticsBridgeRuntime({
          projectPath,
          replaceDiagnostics,
        }),
      )
      .then((runtimeCleanup) => {
        if (disposed) {
          runtimeCleanup();
          return;
        }
        cleanup = runtimeCleanup;
      })
      .catch((error) => {
        if (!disposed) {
          console.error("[DiagnosticsBridge] Failed to initialize runtime bridge", error);
        }
      });

    return () => {
      disposed = true;
      cleanup?.();
      replaceDiagnostics(projectPath, "tsserver", []);
      replaceDiagnostics(projectPath, "eslint", []);
    };
  }, [projectPath, replaceDiagnostics]);
}

export { DIAGNOSTICS_REFRESH_EVENT_NAME };
