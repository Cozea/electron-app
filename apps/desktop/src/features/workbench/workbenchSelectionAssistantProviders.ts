import type { ProviderKind, ServerProvider } from "@cozea/assistant-contracts"

const WORKBENCH_ASSISTANT_PROVIDERS = [
  "codex",
  "claudeAgent",
  "cursor",
  "opencode",
] as const satisfies ReadonlyArray<ProviderKind>

function resolveWorkbenchAssistantProvider(snapshot: ServerProvider): ProviderKind | null {
  const candidate = snapshot.provider ?? snapshot.driver ?? snapshot.instanceId
  return WORKBENCH_ASSISTANT_PROVIDERS.find((provider) => provider === candidate) ?? null
}

/**
 * Build the launcher allowlist from the instance-authoritative T3 provider snapshot.
 * A null snapshot means the runtime has not loaded yet, while an empty array means
 * the runtime explicitly reports no enabled workbench assistant providers.
 */
export function resolveEnabledWorkbenchAssistantProviders(
  providers: ReadonlyArray<ServerProvider> | null,
): ReadonlyArray<ProviderKind> | null {
  if (providers === null) {
    return null
  }

  const enabledProviders = new Set<ProviderKind>()
  for (const snapshot of providers) {
    if (!snapshot.enabled) continue
    const provider = resolveWorkbenchAssistantProvider(snapshot)
    if (provider) enabledProviders.add(provider)
  }
  return [...enabledProviders]
}
