import type { ProviderKind, ServerProvider } from "@cozea/assistant-contracts";
import type { Effect, Stream } from "effect";

export const BUILT_IN_PROVIDER_ORDER = [
  "codex",
  "claudeAgent",
  "opencode",
  "cursor",
] as const satisfies ReadonlyArray<ProviderKind>;

export type ProviderSnapshotSource = {
  readonly provider: ProviderKind;
  readonly getSnapshot: Effect.Effect<ServerProvider>;
  readonly refresh: Effect.Effect<ServerProvider>;
  readonly streamChanges: Stream.Stream<ServerProvider>;
};

type ProviderCatalogEntry = Omit<ProviderSnapshotSource, "provider">;

export function buildBuiltInProviderCatalog(input: {
  readonly codexProvider: ProviderCatalogEntry;
  readonly claudeProvider: ProviderCatalogEntry;
  readonly openCodeProvider: ProviderCatalogEntry;
  readonly cursorProvider: ProviderCatalogEntry;
}): ReadonlyArray<ProviderSnapshotSource> {
  return [
    {
      provider: "codex",
      getSnapshot: input.codexProvider.getSnapshot,
      refresh: input.codexProvider.refresh,
      streamChanges: input.codexProvider.streamChanges,
    },
    {
      provider: "claudeAgent",
      getSnapshot: input.claudeProvider.getSnapshot,
      refresh: input.claudeProvider.refresh,
      streamChanges: input.claudeProvider.streamChanges,
    },
    {
      provider: "opencode",
      getSnapshot: input.openCodeProvider.getSnapshot,
      refresh: input.openCodeProvider.refresh,
      streamChanges: input.openCodeProvider.streamChanges,
    },
    {
      provider: "cursor",
      getSnapshot: input.cursorProvider.getSnapshot,
      refresh: input.cursorProvider.refresh,
      streamChanges: input.cursorProvider.streamChanges,
    },
  ] satisfies ReadonlyArray<ProviderSnapshotSource>;
}
