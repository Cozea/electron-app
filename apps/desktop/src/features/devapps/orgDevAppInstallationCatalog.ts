import type { OrgDevAppInstallation } from "@shared/orgDevAppInstallation"

export function activeInstallationsByPublication(
  installations: ReadonlyArray<OrgDevAppInstallation>,
): Map<string, OrgDevAppInstallation> {
  return new Map(
    installations
      .filter((installation) => installation.active)
      .map((installation) => [installation.publicationId, installation] as const),
  )
}

export function isOrgDevAppUpdateAvailable(
  installations: ReadonlyArray<OrgDevAppInstallation>,
  publicationId: string,
  catalogVersion: number,
): boolean {
  const installed = installations.find(
    (installation) => installation.active && installation.publicationId === publicationId,
  )
  return Boolean(installed && installed.activeRelease.version !== catalogVersion)
}

export function totalInstalledDevAppBytes(
  installations: ReadonlyArray<OrgDevAppInstallation>,
): number {
  return installations.reduce((total, installation) => total + installation.sizeBytes, 0)
}
