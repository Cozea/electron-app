import { Schema } from "effect";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { ModelCapabilities } from "./model";
import { ProviderKind } from "./orchestration";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance";
import { ServerSettings } from "./settings";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue =
  | {
      kind: "keybindings.malformed-config";
      message: string;
    }
  | {
      kind: "keybindings.invalid-entry";
      message: string;
      index: number;
    };

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderState = Schema.Literals(["ready", "warning", "error", "disabled"]);
export type ServerProviderState = typeof ServerProviderState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderAuth = Schema.Struct({
  status: ServerProviderAuthStatus,
  type: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
});
export interface ServerProviderAuth {
  status: ServerProviderAuthStatus;
  type?: string;
  label?: string;
}

export const ServerProviderModel = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  shortName: Schema.optional(TrimmedNonEmptyString),
  subProvider: Schema.optional(TrimmedNonEmptyString),
  isCustom: Schema.Boolean,
  isDefault: Schema.optional(Schema.Boolean),
  isLegacy: Schema.optional(Schema.Boolean),
  capabilities: Schema.NullOr(ModelCapabilities),
});
export interface ServerProviderModel {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  isCustom: boolean;
  isDefault?: boolean;
  isLegacy?: boolean;
  capabilities: ModelCapabilities | null;
}

export const ServerProviderSlashCommandInput = Schema.Struct({
  hint: TrimmedNonEmptyString,
});
export interface ServerProviderSlashCommandInput {
  hint: string;
}

export const ServerProviderSlashCommand = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  input: Schema.optional(ServerProviderSlashCommandInput),
});
export interface ServerProviderSlashCommand {
  name: string;
  description?: string;
  input?: ServerProviderSlashCommandInput;
}

export const ServerProviderSkill = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  path: TrimmedNonEmptyString,
  scope: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  displayName: Schema.optional(TrimmedNonEmptyString),
  shortDescription: Schema.optional(TrimmedNonEmptyString),
});
export interface ServerProviderSkill {
  name: string;
  description?: string;
  path: string;
  scope?: string;
  enabled: boolean;
  displayName?: string;
  shortDescription?: string;
}

export const ServerProvider = Schema.Struct({
  provider: ProviderKind,
  instanceId: Schema.optional(ProviderInstanceId),
  driver: Schema.optional(ProviderDriverKind),
  displayName: Schema.optional(TrimmedNonEmptyString),
  accentColor: Schema.optional(TrimmedNonEmptyString),
  badgeLabel: Schema.optional(TrimmedNonEmptyString),
  requiresNewThreadForModelChange: Schema.optional(Schema.Boolean),
  supportsConversationRollback: Schema.optional(Schema.Boolean),
  showInteractionModeToggle: Schema.optional(Schema.Boolean),
  supportsTextGeneration: Schema.optional(Schema.Boolean),
  setup: Schema.optional(Schema.Struct({ canAuthenticate: Schema.Boolean, canInstall: Schema.Boolean })),
  availability: Schema.optional(Schema.Literals(["available", "unavailable"])),
  unavailableReason: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  version: Schema.NullOr(TrimmedNonEmptyString),
  status: ServerProviderState,
  auth: ServerProviderAuth,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
  accountRateLimits: Schema.optional(Schema.Unknown),
  versionAdvisory: Schema.optional(
    Schema.Struct({
      status: Schema.Literals(["unknown", "current", "behind_latest"]),
      currentVersion: Schema.NullOr(TrimmedNonEmptyString),
      latestVersion: Schema.NullOr(TrimmedNonEmptyString),
      updateCommand: Schema.NullOr(TrimmedNonEmptyString),
      canUpdate: Schema.Boolean,
      checkedAt: Schema.NullOr(IsoDateTime),
      message: Schema.NullOr(TrimmedNonEmptyString),
    }),
  ),
  updateState: Schema.optional(
    Schema.Struct({
      status: Schema.Literals(["idle", "queued", "running", "succeeded", "failed", "unchanged"]),
      startedAt: Schema.NullOr(IsoDateTime),
      finishedAt: Schema.NullOr(IsoDateTime),
      message: Schema.NullOr(TrimmedNonEmptyString),
      output: Schema.NullOr(Schema.String),
    }),
  ),
  models: Schema.Array(ServerProviderModel),
  slashCommands: Schema.Array(ServerProviderSlashCommand).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  skills: Schema.Array(ServerProviderSkill).pipe(Schema.withDecodingDefault(() => [])),
});
export interface ServerProvider {
  provider: ProviderKind;
  instanceId?: ProviderInstanceId;
  driver?: ProviderDriverKind;
  displayName?: string;
  accentColor?: string;
  badgeLabel?: string;
  requiresNewThreadForModelChange?: boolean;
  supportsConversationRollback?: boolean;
  showInteractionModeToggle?: boolean;
  supportsTextGeneration?: boolean;
  setup?: { canAuthenticate: boolean; canInstall: boolean };
  availability?: "available" | "unavailable";
  unavailableReason?: string;
  enabled: boolean;
  installed: boolean;
  version: string | null;
  status: ServerProviderState;
  auth: ServerProviderAuth;
  checkedAt: string;
  message?: string;
  accountRateLimits?: unknown;
  versionAdvisory?: {
    status: "unknown" | "current" | "behind_latest";
    currentVersion: string | null;
    latestVersion: string | null;
    updateCommand: string | null;
    canUpdate: boolean;
    checkedAt: string | null;
    message: string | null;
  };
  updateState?: {
    status: "idle" | "queued" | "running" | "succeeded" | "failed" | "unchanged";
    startedAt: string | null;
    finishedAt: string | null;
    message: string | null;
    output: string | null;
  };
  models: ReadonlyArray<ServerProviderModel>;
  slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  skills: ReadonlyArray<ServerProviderSkill>;
}

const ServerProviders = Schema.Array(ServerProvider);

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviders,
  availableEditors: Schema.Array(EditorId),
  settings: ServerSettings,
});
export interface ServerConfig {
  cwd: string;
  keybindingsConfigPath: string;
  keybindings: ResolvedKeybindingsConfig;
  issues: ReadonlyArray<ServerConfigIssue>;
  providers: ReadonlyArray<ServerProvider>;
  availableEditors: ReadonlyArray<EditorId>;
  settings: ServerSettings;
}

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export interface ServerUpsertKeybindingResult {
  keybindings: ResolvedKeybindingsConfig;
  issues: ReadonlyArray<ServerConfigIssue>;
}

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  settings: Schema.optional(ServerSettings),
});
export interface ServerConfigUpdatedPayload {
  issues: ReadonlyArray<ServerConfigIssue>;
  settings?: ServerSettings;
}

export const ServerProviderUpdatedPayload = Schema.Struct({
  providers: ServerProviders,
});
export interface ServerProviderUpdatedPayload {
  providers: ReadonlyArray<ServerProvider>;
}
