import type { BrowserHttpDiagnostic, CozeaBrowserSurfaceState } from "@shared/browserSurfaceTypes";

export type BrowserPageError =
  | {
      readonly kind: "transport";
      readonly url: string;
      readonly code: number;
      readonly description: string;
    }
  | {
      readonly kind: "http";
      readonly diagnostic: BrowserHttpDiagnostic;
    };

export function resolveBrowserPageError(
  state: CozeaBrowserSurfaceState | null | undefined,
): BrowserPageError | null {
  if (state?.navStatus.kind === "LoadFailed") {
    return {
      kind: "transport",
      url: state.navStatus.url,
      code: state.navStatus.code,
      description: state.navStatus.description,
    };
  }
  return state?.httpDiagnostic ? { kind: "http", diagnostic: state.httpDiagnostic } : null;
}
