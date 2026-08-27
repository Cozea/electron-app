import type { ServerConfig } from "@cozea/assistant-contracts";

export interface ServerConfigStreamEvent {
  readonly version: 1;
  readonly type: "snapshot" | "keybindingsUpdated" | "providerStatuses" | "settingsUpdated";
  readonly config?: ServerConfig;
  readonly payload?: {
    readonly keybindings?: ServerConfig["keybindings"];
    readonly issues?: ServerConfig["issues"];
    readonly providers?: ServerConfig["providers"];
    readonly settings?: ServerConfig["settings"];
  };
}

/** Apply one T3 subscribeServerConfig stream event onto the current config snapshot. */
export function applyServerConfigProjection(
  current: ServerConfig | null,
  event: ServerConfigStreamEvent,
): ServerConfig | null {
  switch (event.type) {
    case "snapshot":
      return event.config ?? null;
    case "keybindingsUpdated":
      if (!current || !event.payload) {
        return current;
      }
      return {
        ...current,
        keybindings: event.payload.keybindings ?? current.keybindings,
        issues: event.payload.issues ?? current.issues,
      };
    case "providerStatuses":
      if (!current || !event.payload) {
        return current;
      }
      return {
        ...current,
        providers: event.payload.providers ?? current.providers,
      };
    case "settingsUpdated":
      if (!current || !event.payload) {
        return current;
      }
      return {
        ...current,
        settings: event.payload.settings ?? current.settings,
      };
    default:
      return current;
  }
}
