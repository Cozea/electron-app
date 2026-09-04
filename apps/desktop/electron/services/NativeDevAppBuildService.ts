import { createHash } from "node:crypto"
import fs, { type Dirent } from "node:fs"
import path from "node:path"

import {
  buildNativeDevApp,
  NativeDevAppBuildError,
} from "../../../../scripts/devapps/native-builder"
import type {
  DevAppAuthoringManifestV3,
  DevAppNativeReactSurfaceContributionV3,
  DevAppReleaseManifestV1,
} from "../../../../shared/devAppManifestV3"
import type { DevAppPreviewDiagnostic, DevAppPreviewNativeReactView } from "../../../../shared/devAppPreviewTypes"
import type { NativeDevAppModuleService } from "./NativeDevAppModuleService"

export interface NativeDevAppDevelopmentBuild {
  manifest: DevAppAuthoringManifestV3
  release: DevAppReleaseManifestV1
  view: DevAppPreviewNativeReactView
  outputRoot: string
}

/** Builds one immutable development generation and exposes it through the module service. */
export class NativeDevAppBuildService {
  constructor(
    private readonly getBuildRoot: () => string,
    private readonly modules: NativeDevAppModuleService,
  ) {}

  async buildDevelopment(options: {
    sourceId: string
    packageRoot: string
    generation: number
    surfaceId?: string | null
  }): Promise<NativeDevAppDevelopmentBuild> {
    const generation = `g${options.generation}`
    const sourceRoot = path.join(this.getBuildRoot(), "development", options.sourceId)
    const outputRoot = path.join(sourceRoot, generation)
    fs.mkdirSync(sourceRoot, { recursive: true })

    const result = await buildNativeDevApp({
      packageRoot: options.packageRoot,
      outputRoot,
    })
    const surface = selectNativeSurface(result.plan.manifest, options.surfaceId)
    const rendererModule = result.release.rendererModules?.[surface.renderer.module]
    if (!rendererModule) {
      throw new NativeDevAppBuildError(
        `The release did not emit renderer module ${surface.renderer.module}.`,
      )
    }

    this.modules.registerBuild({
      registrationId: options.sourceId,
      generation,
      root: outputRoot,
    })

    const moduleUrl = this.modules.buildAssetUrl(
      options.sourceId,
      generation,
      rendererModule.entry,
    )
    const stylesUrl = rendererModule.styles
      ? this.modules.buildAssetUrl(options.sourceId, generation, rendererModule.styles)
      : undefined

    this.pruneOldGenerations(sourceRoot, generation)

    return {
      manifest: result.plan.manifest,
      release: result.release,
      outputRoot,
      view: {
        kind: "nativeReact",
        appId: result.release.appId,
        appVersion: result.release.appVersion,
        surfaceId: surface.id,
        component: surface.renderer.component,
        moduleUrl,
        ...(stylesUrl ? { stylesUrl } : {}),
      },
    }
  }

  releaseDevelopment(sourceId: string): void {
    this.modules.releaseBuild(sourceId)
    try {
      fs.rmSync(path.join(this.getBuildRoot(), "development", sourceId), {
        recursive: true,
        force: true,
      })
    } catch {
      // Build cleanup is best effort. The opaque registration is already revoked.
    }
  }

  diagnostics(error: unknown): DevAppPreviewDiagnostic[] {
    if (error instanceof NativeDevAppBuildError && error.diagnostics.length > 0) {
      return error.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        severity: "blocker",
        message: diagnostic.message,
        field: diagnostic.field,
      }))
    }
    return [
      {
        code: "native-build-failed",
        severity: "blocker",
        message: error instanceof Error ? error.message : "The native DevApp build failed.",
        fix: "Open the build diagnostics, fix the package, and save a file to rebuild.",
      },
    ]
  }

  private pruneOldGenerations(sourceRoot: string, activeGeneration: string): void {
    let entries: Dirent[]
    try {
      entries = fs.readdirSync(sourceRoot, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === activeGeneration) continue
      try {
        fs.rmSync(path.join(sourceRoot, entry.name), { recursive: true, force: true })
      } catch {
        // A stale generation may still have an open sourcemap handle on Windows.
      }
    }
  }
}

function selectNativeSurface(
  manifest: DevAppAuthoringManifestV3,
  requestedSurfaceId?: string | null,
): DevAppNativeReactSurfaceContributionV3 {
  const nativeSurfaces = manifest.contributes.surfaces.filter(
    (surface): surface is DevAppNativeReactSurfaceContributionV3 =>
      surface.renderer.kind === "native-react",
  )
  const selected = requestedSurfaceId
    ? nativeSurfaces.find((surface) => surface.id === requestedSurfaceId)
    : nativeSurfaces.find((surface) => surface.default) ?? nativeSurfaces[0]
  if (!selected) {
    throw new NativeDevAppBuildError(
      requestedSurfaceId
        ? `This DevApp has no native React surface named ${requestedSurfaceId}.`
        : "This DevApp does not contribute a native React surface.",
    )
  }
  return selected
}

export function nativeDevAppInstallationId(appId: string, sourceId: string): string {
  return `dev:${createHash("sha256").update(`${appId}\0${sourceId}`).digest("hex").slice(0, 24)}`
}
