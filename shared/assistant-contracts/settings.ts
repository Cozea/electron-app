// @ts-nocheck
import { Effect, Schema, SchemaTransformation } from "effect";

import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas";
import {
  ClaudeModelOptions,
  CodexModelOptions,
  CursorModelOptions,
  OpenCodeModelOptions,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
} from "./model";
import { ModelSelection } from "./orchestration";

// ── Client Settings (local-only) ───────────────────────────────

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";

export const ClientSettingsSchema = Schema.Struct({
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  diffWordWrap: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_PROJECT_SORT_ORDER),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_THREAD_SORT_ORDER),
  ),
  timestampFormat: TimestampFormat.pipe(Schema.withDecodingDefault(() => DEFAULT_TIMESTAMP_FORMAT)),
});
export type ClientSettings = typeof ClientSettingsSchema.Type;

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeSync(ClientSettingsSchema)({});

// ── Server Settings (server-authoritative) ────────────────────

export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

const makeBinaryPathSetting = (fallback: string) =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value, _opts, _ast) => Effect.succeed(value || fallback),
        encode: (value, _opts, _ast) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(() => fallback),
  );

export const CodexSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("codex"),
  homePath: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export interface CodexSettings {
  enabled: boolean;
  binaryPath: string;
  homePath: string;
  customModels: string[];
}

export const ClaudeSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("claude"),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export interface ClaudeSettings {
  enabled: boolean;
  binaryPath: string;
  customModels: string[];
}


export const CursorSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  binaryPath: makeBinaryPathSetting("agent"),
  apiEndpoint: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export interface CursorSettings {
  enabled: boolean;
  binaryPath: string;
  apiEndpoint: string;
  customModels: string[];
}

export const OpenCodeSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("opencode"),
  serverUrl: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  serverPassword: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export interface OpenCodeSettings {
  enabled: boolean;
  binaryPath: string;
  serverUrl: string;
  serverPassword: string;
  customModels: string[];
}

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  defaultThreadEnvMode: ThreadEnvMode.pipe(
    Schema.withDecodingDefault(() => "local" as const satisfies ThreadEnvMode),
  ),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(() => ({
      provider: "codex" as const,
      model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
    })),
  ),

  // Provider specific settings
  providers: Schema.Struct({
    codex: CodexSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    claudeAgent: ClaudeSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    cursor: CursorSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    opencode: OpenCodeSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  }).pipe(Schema.withDecodingDefault(() => ({}))),
});
export interface ServerSettings {
  enableAssistantStreaming: boolean;
  defaultThreadEnvMode: ThreadEnvMode;
  textGenerationModelSelection: ModelSelection;
  providers: {
    codex: CodexSettings;
    claudeAgent: ClaudeSettings;
    cursor: CursorSettings;
    opencode: OpenCodeSettings;
  };
}

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

// ── Unified type ─────────────────────────────────────────────────────

export type UnifiedSettings = ServerSettings & ClientSettings;
export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  ...DEFAULT_CLIENT_SETTINGS,
};

// ── Server Settings Patch (replace with a Schema.deepPartial if available) ──────────────────────────────────────────

const CodexModelOptionsPatch = Schema.Struct({
  reasoningEffort: Schema.optional(CodexModelOptions.fields.reasoningEffort),
  fastMode: Schema.optional(CodexModelOptions.fields.fastMode),
});

const ClaudeModelOptionsPatch = Schema.Struct({
  thinking: Schema.optional(ClaudeModelOptions.fields.thinking),
  effort: Schema.optional(ClaudeModelOptions.fields.effort),
  fastMode: Schema.optional(ClaudeModelOptions.fields.fastMode),
});


const CursorModelOptionsPatch = Schema.Struct({
  reasoning: Schema.optional(CursorModelOptions.fields.reasoning),
  fastMode: Schema.optional(CursorModelOptions.fields.fastMode),
  thinking: Schema.optional(CursorModelOptions.fields.thinking),
  contextWindow: Schema.optional(CursorModelOptions.fields.contextWindow),
});

const OpenCodeModelOptionsPatch = Schema.Struct({
  variant: Schema.optional(OpenCodeModelOptions.fields.variant),
  agent: Schema.optional(OpenCodeModelOptions.fields.agent),
});

const CursorSettingsPatch = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  binaryPath: Schema.optional(Schema.String),
  apiEndpoint: Schema.optional(Schema.String),
  customModels: Schema.optional(Schema.Array(Schema.String)),
});

const OpenCodeSettingsPatch = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  binaryPath: Schema.optional(Schema.String),
  serverUrl: Schema.optional(Schema.String),
  serverPassword: Schema.optional(Schema.String),
  customModels: Schema.optional(Schema.Array(Schema.String)),
});

const ModelSelectionPatch = Schema.Union([
  Schema.Struct({
    provider: Schema.optional(Schema.Literal("codex")),
    model: Schema.optional(TrimmedNonEmptyString),
    options: Schema.optional(CodexModelOptionsPatch),
  }),
  Schema.Struct({
    provider: Schema.optional(Schema.Literal("claudeAgent")),
    model: Schema.optional(TrimmedNonEmptyString),
    options: Schema.optional(ClaudeModelOptionsPatch),
  }),
  Schema.Struct({
    provider: Schema.optional(Schema.Literal("cursor")),
    model: Schema.optional(TrimmedNonEmptyString),
    options: Schema.optional(CursorModelOptionsPatch),
  }),
  Schema.Struct({
    provider: Schema.optional(Schema.Literal("opencode")),
    model: Schema.optional(TrimmedNonEmptyString),
    options: Schema.optional(OpenCodeModelOptionsPatch),
  }),
]);

const CodexSettingsPatch = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  binaryPath: Schema.optional(Schema.String),
  homePath: Schema.optional(Schema.String),
  customModels: Schema.optional(Schema.Array(Schema.String)),
});

const ClaudeSettingsPatch = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  binaryPath: Schema.optional(Schema.String),
  customModels: Schema.optional(Schema.Array(Schema.String)),
});

export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optional(Schema.Boolean),
  defaultThreadEnvMode: Schema.optional(ThreadEnvMode),
  textGenerationModelSelection: Schema.optional(ModelSelectionPatch),
  providers: Schema.optional(
    Schema.Struct({
      codex: Schema.optional(CodexSettingsPatch),
      claudeAgent: Schema.optional(ClaudeSettingsPatch),
      cursor: Schema.optional(CursorSettingsPatch),
      opencode: Schema.optional(OpenCodeSettingsPatch),
    }),
  ),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;
