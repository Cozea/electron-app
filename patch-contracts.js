const fs = require('fs');

const modelPath = '/Users/admin/Downloads/electron-app-main/shared/assistant-contracts/model.ts';
let modelContent = fs.readFileSync(modelPath, 'utf8');

const cursorModels = `export const CURSOR_REASONING_OPTIONS = ["low", "medium", "high", "max", "xhigh"] as const;
export const CursorReasoningOption = Schema.Literals(CURSOR_REASONING_OPTIONS);
export type CursorReasoningOption = typeof CursorReasoningOption.Type;

export const CursorModelOptions = Schema.Struct({
  reasoning: Schema.optional(CursorReasoningOption),
  fastMode: Schema.optional(Schema.Boolean),
  thinking: Schema.optional(Schema.Boolean),
  contextWindow: Schema.optional(Schema.String),
});
export type CursorModelOptions = typeof CursorModelOptions.Type;

export const OpenCodeModelOptions = Schema.Struct({
  variant: Schema.optional(TrimmedNonEmptyString),
  agent: Schema.optional(TrimmedNonEmptyString),
});
export type OpenCodeModelOptions = typeof OpenCodeModelOptions.Type;
`;

modelContent = modelContent.replace(
  'export type ProviderReasoningEffort = CodexReasoningEffort | ClaudeCodeEffort;',
  cursorModels + '\nexport type ProviderReasoningEffort = CodexReasoningEffort | ClaudeCodeEffort | CursorReasoningOption;'
);

modelContent = modelContent.replace(
  'export const ProviderModelOptions = Schema.Struct({\n  codex: Schema.optional(CodexModelOptions),\n  claudeAgent: Schema.optional(ClaudeModelOptions),\n});',
  `export const ProviderModelOptions = Schema.Struct({
  codex: Schema.optional(CodexModelOptions),
  claudeAgent: Schema.optional(ClaudeModelOptions),
  cursor: Schema.optional(CursorModelOptions),
  opencode: Schema.optional(OpenCodeModelOptions),
});`
);

modelContent = modelContent.replace(
  'export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {\n  codex: "gpt-5.4",\n  claudeAgent: "claude-sonnet-4-6",\n};',
  `export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  codex: "gpt-5.4",
  claudeAgent: "claude-sonnet-4-6",
  cursor: "auto",
  opencode: "openai/gpt-5",
};`
);

modelContent = modelContent.replace(
  'export const DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {\n  codex: "gpt-5.4-mini",\n  claudeAgent: "claude-haiku-4-5",\n};',
  `export const DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  codex: "gpt-5.4-mini",
  claudeAgent: "claude-haiku-4-5",
  cursor: "composer-2",
  opencode: "openai/gpt-5",
};`
);

modelContent = modelContent.replace(
  `  claudeAgent: {
    opus: "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  },`,
  `  claudeAgent: {
    opus: "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-opus-4-6-20251117": "claude-opus-4-6",
    sonnet: "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4-6-20251117": "claude-sonnet-4-6",
    haiku: "claude-haiku-4-5",
    "haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4.5": "claude-haiku-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  },
  cursor: {
    composer: "composer-2",
    "composer-1.5": "composer-1.5",
    "composer-1": "composer-1.5",
    "opus-4.6-thinking": "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "sonnet-4.6-thinking": "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "opus-4.5-thinking": "claude-opus-4-5",
    "opus-4.5": "claude-opus-4-5",
  },
  opencode: {},`
);

modelContent = modelContent.replace(
  'export const PROVIDER_DISPLAY_NAMES: Record<ProviderKind, string> = {\n  codex: "Codex",\n  claudeAgent: "Claude",\n};',
  `export const PROVIDER_DISPLAY_NAMES: Record<ProviderKind, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
};`
);

fs.writeFileSync(modelPath, modelContent, 'utf8');
console.log("model.ts patched successfully.");

const settingsPath = '/Users/admin/Downloads/electron-app-main/shared/assistant-contracts/settings.ts';
let settingsContent = fs.readFileSync(settingsPath, 'utf8');

settingsContent = settingsContent.replace(
  '  ClaudeModelOptions,\n  CodexModelOptions,\n  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,\n} from "./model";',
  `  ClaudeModelOptions,
  CodexModelOptions,
  CursorModelOptions,
  OpenCodeModelOptions,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
} from "./model";`
);

const newSettings = `
export const CursorSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  binaryPath: makeBinaryPathSetting("agent"),
  apiEndpoint: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export type CursorSettings = typeof CursorSettings.Type;

export const OpenCodeSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("opencode"),
  serverUrl: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  serverPassword: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export type OpenCodeSettings = typeof OpenCodeSettings.Type;
`;

settingsContent = settingsContent.replace(
  'export const ServerSettings = Schema.Struct({',
  newSettings + '\nexport const ServerSettings = Schema.Struct({'
);

settingsContent = settingsContent.replace(
  '  // Provider specific settings\n  providers: Schema.Struct({\n    codex: CodexSettings.pipe(Schema.withDecodingDefault(() => ({}))),\n    claudeAgent: ClaudeSettings.pipe(Schema.withDecodingDefault(() => ({}))),\n  }).pipe(Schema.withDecodingDefault(() => ({}))),',
  `  // Provider specific settings
  providers: Schema.Struct({
    codex: CodexSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    claudeAgent: ClaudeSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    cursor: CursorSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    opencode: OpenCodeSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  }).pipe(Schema.withDecodingDefault(() => ({}))),`
);

const newPatches = `
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
`;

settingsContent = settingsContent.replace(
  'const ModelSelectionPatch = Schema.Union([',
  newPatches + '\nconst ModelSelectionPatch = Schema.Union(['
);

settingsContent = settingsContent.replace(
  '    options: Schema.optional(ClaudeModelOptionsPatch),\n  }),\n]);',
  `    options: Schema.optional(ClaudeModelOptionsPatch),
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
]);`
);

settingsContent = settingsContent.replace(
  '      codex: Schema.optional(CodexSettingsPatch),\n      claudeAgent: Schema.optional(ClaudeSettingsPatch),\n    }),',
  `      codex: Schema.optional(CodexSettingsPatch),
      claudeAgent: Schema.optional(ClaudeSettingsPatch),
      cursor: Schema.optional(CursorSettingsPatch),
      opencode: Schema.optional(OpenCodeSettingsPatch),
    }),`
);

fs.writeFileSync(settingsPath, settingsContent, 'utf8');
console.log("settings.ts patched successfully.");
