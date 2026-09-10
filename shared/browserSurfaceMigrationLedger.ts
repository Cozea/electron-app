/**
 * Migration ledger for the main-owned `WebContentsView` browser surfaces.
 *
 * This module is the machine-readable half of
 * `docs/browser-webcontentsview-migration-ledger.md`. The architecture test
 * asserts against these entries rather than grepping alone, so a family cannot
 * silently change backend: flipping a surface to the native path requires
 * editing this ledger, which is reviewable in isolation.
 */

import type { BrowserSurfaceKind } from "./browserSurfaceTypes";

/**
 * Browser-backed tile families. Every one must reach `NATIVE_REQUIRED`.
 *
 * Deliberately an alias of `BrowserSurfaceKind` rather than a parallel union:
 * the architecture test asserts the ledger covers every kind, so introducing a
 * new surface kind fails until its migration state is decided here.
 */
export type BrowserSurfaceFamily = BrowserSurfaceKind;

/**
 * Migration states from the modernization plan. A family occupies exactly one.
 *
 * - `LEGACY_WEBVIEW`   renderer-wide T3 `<webview>` host owns the surface.
 * - `NATIVE_SHADOW`    a native view exists for parity tests but is not
 *                      product-visible; the legacy host still paints.
 * - `NATIVE_CANARY`    this family uses the native path while others do not.
 * - `NATIVE_REQUIRED`  the native path is mandatory; falling back is a failure.
 */
export type BrowserSurfaceMigrationState =
  | "LEGACY_WEBVIEW"
  | "NATIVE_SHADOW"
  | "NATIVE_CANARY"
  | "NATIVE_REQUIRED";

/** Which host actually paints the pixels the user sees. */
export type BrowserSurfaceBackend = "renderer-webview" | "main-webcontentsview";

/**
 * Parity of one cross-cutting concern for one family.
 *
 * `legacy-baseline` records behavior measured on the `<webview>` host, which is
 * the target the native path must match. It is not evidence about native code.
 */
export type BrowserSurfaceParityStatus =
  | "legacy-baseline"
  | "native-pending"
  | "native-verified";

export interface BrowserSurfaceMigrationEntry {
  readonly family: BrowserSurfaceFamily;
  readonly state: BrowserSurfaceMigrationState;
  readonly activeBackend: BrowserSurfaceBackend;
  readonly automationParity: BrowserSurfaceParityStatus;
  readonly storageParity: BrowserSurfaceParityStatus;
  readonly overlayParity: BrowserSurfaceParityStatus;
  /** Phase that last moved this row, for bisecting a regression to a phase. */
  readonly lastUpdatedPhase: number;
}

/**
 * States in which the renderer `<webview>` host is still the painting backend.
 * `NATIVE_SHADOW` is included deliberately: a shadow view exists but must not
 * be product-visible, so the legacy host still owns presentation.
 */
const LEGACY_BACKED_STATES: ReadonlySet<BrowserSurfaceMigrationState> = new Set([
  "LEGACY_WEBVIEW",
  "NATIVE_SHADOW",
]);

/** The backend a state implies. Guards against a row claiming a mismatch. */
export function expectedBackendForState(
  state: BrowserSurfaceMigrationState,
): BrowserSurfaceBackend {
  return LEGACY_BACKED_STATES.has(state) ? "renderer-webview" : "main-webcontentsview";
}

/** True once main may create a native view for the family at all. */
export function allowsNativeSurface(state: BrowserSurfaceMigrationState): boolean {
  return state !== "LEGACY_WEBVIEW";
}

/**
 * Current migration state. Phase 0 establishes the baseline: every family is
 * still served by the renderer `<webview>` host and no native code exists yet.
 */
export const BROWSER_SURFACE_MIGRATION_LEDGER: ReadonlyArray<BrowserSurfaceMigrationEntry> = [
  {
    family: "browser",
    // First canary. The native path is exercised by the suite and by
    // `bun run smoke:native-browser-surface`, and PH3-A has now been driven in
    // a running workbench: address-bar and in-page navigation, back, forward,
    // title, favicon, URL and error state, and one surviving browser across a
    // sidebar resize, a group split, maximize and restore.
    //
    // The three parity columns stay pending because none of them has been
    // measured against the legacy host yet, which is what parity means here.
    // Six open defects are recorded in the markdown ledger; D1 (a route change
    // destroys the surface and the rebuilt one never draws) and D2 (native
    // surfaces paint over all application UI, because nothing computes
    // occlusion) both have to be closed before this family can advance.
    // Still unverified interactively: drag-to-move between groups and float,
    // which HTML5 drag-and-drop puts out of reach of synthetic input.
    state: "NATIVE_CANARY",
    activeBackend: "main-webcontentsview",
    automationParity: "native-pending",
    storageParity: "native-pending",
    overlayParity: "native-pending",
    lastUpdatedPhase: 3,
  },
  {
    family: "devServer",
    state: "LEGACY_WEBVIEW",
    activeBackend: "renderer-webview",
    automationParity: "legacy-baseline",
    storageParity: "legacy-baseline",
    overlayParity: "legacy-baseline",
    lastUpdatedPhase: 0,
  },
  {
    family: "projectDevApp",
    state: "LEGACY_WEBVIEW",
    activeBackend: "renderer-webview",
    automationParity: "legacy-baseline",
    storageParity: "legacy-baseline",
    overlayParity: "legacy-baseline",
    lastUpdatedPhase: 0,
  },
  {
    family: "orgDevApp",
    state: "LEGACY_WEBVIEW",
    activeBackend: "renderer-webview",
    automationParity: "legacy-baseline",
    storageParity: "legacy-baseline",
    overlayParity: "legacy-baseline",
    lastUpdatedPhase: 0,
  },
  {
    family: "devAppPreview",
    state: "LEGACY_WEBVIEW",
    activeBackend: "renderer-webview",
    automationParity: "legacy-baseline",
    storageParity: "legacy-baseline",
    overlayParity: "legacy-baseline",
    lastUpdatedPhase: 0,
  },
] as const;

/** Every family that must exist in the ledger, in cutover-reporting order. */
export const BROWSER_SURFACE_FAMILIES: ReadonlyArray<BrowserSurfaceFamily> = [
  "browser",
  "devServer",
  "projectDevApp",
  "orgDevApp",
  "devAppPreview",
] as const;

export function migrationStateFor(
  family: BrowserSurfaceFamily,
): BrowserSurfaceMigrationState {
  const entry = BROWSER_SURFACE_MIGRATION_LEDGER.find((row) => row.family === family);
  if (!entry) throw new Error(`No migration ledger entry for surface family: ${family}`);
  return entry.state;
}

/** True only at final cutover, when the legacy host may be deleted. */
export function isFullyMigrated(): boolean {
  return BROWSER_SURFACE_MIGRATION_LEDGER.every((row) => row.state === "NATIVE_REQUIRED");
}
