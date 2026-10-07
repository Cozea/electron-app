/**
 * Architecture boundaries for the renderer / backend separation.
 * Plan: ~/.claude/plans/how-to-reorganize-the-parallel-cray.md (Stage 0).
 *
 * Existing violations are frozen in `.dependency-cruiser-known-violations.json`
 * (`bun run check:boundaries`). The baseline may only shrink: fixing a violation
 * and regenerating it with `bun run check:boundaries:baseline` is always fine;
 * adding one is not.
 *
 * Layers (one direction):
 *   renderer (apps/desktop/src) -> shared/, packages/, convex/_generated types
 *   shell + backend (apps/desktop/electron, apps/server, apps/projectd) -> shared/, packages/
 *   shared/, packages/ -> packages/ only
 */

const RENDERER = "^apps/desktop/src/"
const SHELL = "^apps/desktop/electron/"
const SERVER = "^apps/server/"
const PROJECTD = "^apps/projectd/"

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "renderer-no-backend",
      comment:
        "The renderer reaches the backend through the typed IPC/RPC contract only, never by importing main-process, server, or projectd code.",
      severity: "error",
      from: { path: RENDERER },
      to: { path: [SHELL, SERVER, PROJECTD, "^vendor/"] },
    },
    {
      name: "renderer-no-node",
      comment: "Renderer code must not import Electron or Node built-ins.",
      severity: "error",
      from: { path: RENDERER, pathNot: "\\.(test|spec)\\.[jt]sx?$" },
      to: { dependencyTypes: ["core"], pathNot: "^(node:)?(events|buffer)$" },
    },
    {
      name: "renderer-no-electron-module",
      comment: "Renderer code must not import the electron package.",
      severity: "error",
      from: { path: RENDERER },
      to: { path: "^node_modules/electron/" },
    },
    {
      name: "server-no-shell",
      comment:
        "apps/server must not import Electron main code (substrate constants, shadow-server handlers). Move shared pieces into a package first.",
      severity: "error",
      from: { path: SERVER },
      to: { path: SHELL },
    },
    {
      name: "projectd-no-app-code",
      comment: "apps/projectd depends on packages/projectd-protocol only, never on other apps.",
      severity: "error",
      from: { path: PROJECTD },
      to: { path: ["^apps/desktop/", SERVER] },
    },
    {
      name: "packages-no-apps",
      comment: "Packages are leaves: they must not import app code.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "shared-no-apps",
      comment: "shared/ is imported by every layer, so it must not import app code.",
      severity: "error",
      from: { path: "^shared/" },
      to: { path: "^apps/" },
    },
    {
      name: "contract-via-app-contract",
      comment:
        "Apps import the renderer/backend contract (ElectronAPI, bootstrap, browser surface) from @cozea/app-contract, not from shared/ directly. The files move into the package later; only the package may reach into shared/ for them.",
      severity: "error",
      from: { path: "^apps/", pathNot: "\\.(test|spec)\\.[jt]sx?$" },
      to: { path: "^shared/(electronApiTypes|desktopBootstrapTypes|browserSurfaceTypes)\\.ts$" },
    },
    {
      name: "no-t3-vendor-outside-seam",
      comment:
        "Only the T3 seam (scripts/, apps/server/src/t3, electron/substrate, packages/contracts/src/t3) may reference vendor/t3code.",
      severity: "error",
      from: {
        path: "^(apps|packages|shared)/",
        pathNot: [
          "^apps/server/src/t3/",
          "^apps/desktop/electron/substrate",
          "^packages/contracts/src/t3/",
        ],
      },
      to: { path: "^vendor/t3code/" },
    },
    {
      name: "no-circular",
      comment: "Circular dependencies make boundaries meaningless.",
      severity: "error",
      from: { path: "^(apps/(server|projectd)|apps/desktop/electron|packages|shared)/" },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: ["/node_modules/", "/out/", "/dist/", "/\\.tmp/", "\\.d\\.ts$", "^vendor/", "/_generated/"],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types"],
    },
    combinedDependencies: true,
    skipAnalysisNotInRules: true,
  },
}
