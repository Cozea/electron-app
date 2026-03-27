// @ts-nocheck
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas";
import {
  ClaudeModelOptions,
  CodexModelOptions,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
} from "./model";
import { ModelSelection } from "./orchestration";

// ── Client Settings (local-only) ───────────────────────────────

export const TimestampFormat = Schema.Literal("locale", "12-hour", "24-hour");
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SidebarProjectSortOrder = Schema.Literal("updated_at", "created_at", "manual");
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SidebarThreadSortOrder = Schema.Literal("updated_at", "created_at");
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

export const ThreadEnvMode = Schema.Literal("local", "worktree");
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

const makeBinaryPathSetting = (fallback: string) =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => Effect.succeed(value || fallback),
        encode: (value) => Effect.succeed(value),
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
export type CodexSettings = typeof CodexSettings.Type;

export const ClaudeSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("claude"),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export type ClaudeSettings = typeof ClaudeSettings.Type;

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
  }).pipe(Schema.withDecodingDefault(() => ({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

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

const ModelSelectionPatch = Schema.Union(
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
);

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
    }),
  ),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;
