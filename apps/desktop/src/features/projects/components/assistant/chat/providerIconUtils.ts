import { type ProviderKind } from "@cozea/assistant-contracts";
import { ClaudeAI, CursorIcon, Gemini, OpenAI, OpenCodeIcon } from "../Icons";
import type { Icon } from "../Icons";
import { PROVIDER_OPTIONS } from "./session-logic";

export type ModelEsque = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  isDefault?: boolean;
  isLegacy?: boolean;
};

export const PROVIDER_ICON_BY_PROVIDER: Record<ProviderKind | "favorites" | "gemini-coming-soon" | "github-copilot-coming-soon", Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
  favorites: OpenCodeIcon as any, // Dummy for favorites
  "gemini-coming-soon": Gemini,
  "github-copilot-coming-soon": OpenCodeIcon as any,
};

export const PROVIDER_DISPLAY_NAMES = Object.fromEntries(
  PROVIDER_OPTIONS.map((option) => [option.value, option.label]),
) as Record<ProviderKind, string>;

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.map((opt) => ({
  ...opt,
  pickerSidebarBadge: undefined as "new" | "soon" | undefined,
}));

export function getDisplayModelName(model: ModelEsque, options?: { preferShortName?: boolean }) {
  if (options?.preferShortName && model.shortName) {
    return model.shortName;
  }
  return model.name;
}

export function getTriggerDisplayModelName(model: ModelEsque) {
  return model.name;
}

export function getTriggerDisplayModelLabel(model: ModelEsque) {
  return `${model.name} (${model.slug})`;
}

export function getProviderLabel(provider: ProviderKind, model: ModelEsque) {
  const providerName = PROVIDER_DISPLAY_NAMES[provider] ?? provider;
  if (model.subProvider) {
    return `${providerName} by ${model.subProvider}`;
  }
  return providerName;
}
