import {
  defaultInstanceIdForDriver,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderState,
} from "@cozea/assistant-contracts"

import { PROVIDER_DISPLAY_NAMES } from "./assistant/chat/providerIconUtils"

export interface ProviderInstanceEntry {
  readonly instanceId: ProviderInstanceId
  readonly driverKind: ProviderDriverKind
  readonly provider: ProviderKind
  readonly displayName: string
  readonly accentColor?: string
  readonly continuationGroupKey?: string
  readonly enabled: boolean
  readonly installed: boolean
  readonly status: ServerProviderState
  readonly isDefault: boolean
  readonly isAvailable: boolean
  readonly snapshot: ServerProvider
  readonly models: ReadonlyArray<ServerProviderModel>
}

function humanizeInstanceId(instanceId: ProviderInstanceId): string {
  return String(instanceId)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter((token) => token.length > 0)
    .map((token) => `${token.charAt(0).toUpperCase()}${token.slice(1)}`)
    .join(" ")
}

function driverKindLabel(driverKind: ProviderDriverKind, provider: ProviderKind): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? String(driverKind)
}

function resolveInstanceDisplayName(
  snapshot: ServerProvider,
  instanceId: ProviderInstanceId,
  driverKind: ProviderDriverKind,
  provider: ProviderKind,
  isDefault: boolean,
): string {
  const snapshotName = snapshot.displayName?.trim()
  const kindLabel = driverKindLabel(driverKind, provider)
  if (snapshotName && snapshotName !== kindLabel) {
    return snapshotName
  }
  if (!isDefault) {
    const humanized = humanizeInstanceId(instanceId)
    if (humanized.length > 0) return humanized
  }
  return snapshotName || kindLabel
}

export function normalizeProviderAccentColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return /^#[0-9a-fA-F]{6}$/u.test(trimmed) ? trimmed : undefined
}

export function providerInstanceIdForSnapshot(snapshot: ServerProvider): ProviderInstanceId {
  return snapshot.instanceId ?? defaultInstanceIdForDriver(snapshot.provider as ProviderDriverKind)
}

export function providerDriverKindForSnapshot(snapshot: ServerProvider): ProviderDriverKind {
  return snapshot.driver ?? (snapshot.provider as ProviderDriverKind)
}

export function deriveProviderInstanceEntries(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderInstanceEntry> {
  return providers.map((snapshot) => {
    const provider = snapshot.provider
    const driverKind = providerDriverKindForSnapshot(snapshot)
    const instanceId = providerInstanceIdForSnapshot(snapshot)
    const defaultId = defaultInstanceIdForDriver(driverKind)
    const isDefault = instanceId === defaultId
    const displayName = resolveInstanceDisplayName(
      snapshot,
      instanceId,
      driverKind,
      provider,
      isDefault,
    )
    return {
      instanceId,
      driverKind,
      provider,
      displayName,
      accentColor: normalizeProviderAccentColor(snapshot.accentColor),
      enabled: snapshot.enabled,
      installed: snapshot.installed,
      status: snapshot.status,
      isDefault,
      isAvailable: snapshot.availability !== "unavailable",
      snapshot,
      models: snapshot.models,
    } satisfies ProviderInstanceEntry
  })
}

export function sortProviderInstanceEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyArray<ProviderInstanceEntry> {
  const byKind = new Map<ProviderDriverKind, ProviderInstanceEntry[]>()
  for (const entry of entries) {
    const bucket = byKind.get(entry.driverKind)
    if (bucket) {
      bucket.push(entry)
    } else {
      byKind.set(entry.driverKind, [entry])
    }
  }

  const sorted: ProviderInstanceEntry[] = []
  for (const bucket of byKind.values()) {
    sorted.push(
      ...bucket.filter((entry) => entry.isDefault),
      ...bucket.filter((entry) => !entry.isDefault),
    )
  }
  return sorted
}

export function getProviderInstanceEntry(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
): ProviderInstanceEntry | undefined {
  return deriveProviderInstanceEntries(providers).find((entry) => entry.instanceId === instanceId)
}

export function getProviderInstanceModels(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
): ReadonlyArray<ServerProviderModel> {
  return getProviderInstanceEntry(providers, instanceId)?.models ?? []
}

export function resolveSelectableProviderInstance(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId | null | undefined,
): ProviderInstanceId | undefined {
  const entries = deriveProviderInstanceEntries(providers)
  if (instanceId) {
    const requested = entries.find((entry) => entry.instanceId === instanceId)
    if (requested?.enabled && requested.isAvailable) {
      return requested.instanceId
    }
  }
  return entries.find((entry) => entry.enabled && entry.isAvailable)?.instanceId
}
