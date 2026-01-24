import type { ProviderOptionsState } from "@/components/assistant/ProviderOptions";

export type StoredModelSettings = {
  selectedAgent?: "Agent" | "Assistant";
  selectedPerformance?: "High" | "Medium" | "Low";
  toolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  providerOptions?: ProviderOptionsState;
  thinkingEffort?: "low" | "medium" | "high";
};

const STORAGE_KEY = "crosscode.ai.modelSettings.v1";

export function loadModelSettings(): Record<string, StoredModelSettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, StoredModelSettings>;
  } catch {
    return {};
  }
}

export function saveModelSettings(settings: Record<string, StoredModelSettings>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors (e.g., quota exceeded or disabled storage)
  }
}
