import { createT3ProviderSetupApi } from "./createT3ProviderSetupApi";
import type {
  ContextMenuItem,
  NativeApi,
  ServerProviderUpdatedPayload,
  ServerSettings,
  ServerSettingsPatch,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "@cozea/assistant-contracts";
import { WS_METHODS } from "@cozea/contracts";
import type { T3RpcSessionHandle } from "@cozea/client-runtime";

import { showContextMenuFallback } from "@/lib/contextMenuFallback";

import { createT3OrchestrationApiFromClient } from "./createT3OrchestrationApi";

function readDesktopBridge() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.desktopBridge ?? null;
}

/**
 * Build a full NativeApi surface backed by one T3 RPC session (Phase T5).
 * Desktop-only affordances (dialogs, context menu) stay on desktopBridge.
 */
export function createT3NativeApi(session: T3RpcSessionHandle, options?: { localProviderSetup?: boolean }): NativeApi {
  const orchestrationHandle = createT3OrchestrationApiFromClient(session.orchestration);

  const vcsListeners = new Set<Parameters<NativeApi["vcs"]["onActionProgress"]>[0]>();
  void session.vcs.onActionProgress((event) => {
    for (const listener of vcsListeners) {
      listener(event);
    }
  });

  const terminalListeners = new Set<Parameters<NativeApi["terminal"]["onEvent"]>[0]>();
  void session.terminal.onEvent((event) => {
    for (const listener of terminalListeners) {
      listener(event);
    }
  });

  const vcs: NativeApi["vcs"] = {
    pull: (input) => session.vcs.pull(input),
    status: (input) => session.vcs.status(input),
    runStackedAction: (input) => session.vcs.runStackedAction(input),
    listBranches: (input) => session.vcs.listBranches(input),
    createWorktree: (input) => session.vcs.createWorktree(input),
    removeWorktree: (input) => session.vcs.removeWorktree(input),
    createBranch: (input) => session.vcs.createBranch(input),
    checkout: (input) => session.vcs.checkout(input),
    init: (input) => session.vcs.init(input),
    resolvePullRequest: (input) => session.vcs.resolvePullRequest(input),
    preparePullRequestThread: (input) => session.vcs.preparePullRequestThread(input),
    onActionProgress: (callback) => {
      vcsListeners.add(callback);
      return () => {
        vcsListeners.delete(callback);
      };
    },
  };

  return {
    ...(options?.localProviderSetup ? { providerSetup: createT3ProviderSetupApi(session.client) } : {}),
    dialogs: {
      pickFolder: async () => readDesktopBridge()?.pickFolder?.() ?? null,
      confirm: async (message) => {
        const bridge = readDesktopBridge();
        if (bridge?.confirm) {
          return bridge.confirm(message);
        }
        return window.confirm(message);
      },
    },
    terminal: {
      open: (input) => session.terminal.open(input),
      write: (input) => session.terminal.write(input),
      resize: (input) => session.terminal.resize(input),
      clear: (input) => session.terminal.clear(input),
      restart: (input) => session.terminal.restart(input),
      close: (input) => session.terminal.closeSession(input),
      onEvent: (callback) => {
        terminalListeners.add(callback);
        return () => {
          terminalListeners.delete(callback);
        };
      },
    },
    projects: {
      searchEntries: (input) =>
        session.client.callUnary(WS_METHODS.projectsSearchEntries, input) as ReturnType<
          NativeApi["projects"]["searchEntries"]
        >,
      writeFile: (input) =>
        session.client.callUnary(WS_METHODS.projectsWriteFile, input) as ReturnType<
          NativeApi["projects"]["writeFile"]
        >,
    },
    shell: {
      openInEditor: (cwd, editor) =>
        session.client.callUnary(WS_METHODS.shellOpenInEditor, { cwd, editor }) as Promise<void>,
      openExternal: async (url) => {
        const bridge = readDesktopBridge();
        if (bridge?.openExternal) {
          const opened = await bridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    vcs,
    git: vcs,
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        const bridge = readDesktopBridge();
        if (bridge?.showContextMenu) {
          return bridge.showContextMenu(items, position) as Promise<T | null>;
        }
        return showContextMenuFallback(items, position);
      },
    },
    server: {
      getConfig: () => session.serverConfig.getConfig(),
      onConfigUpdated: (listener) => session.serverConfig.subscribeServerConfig(listener),
      refreshProviders: async () => {
        await session.serverConfig.refreshProviders();
        const config = await session.serverConfig.getConfig();
        return { providers: config.providers } satisfies ServerProviderUpdatedPayload;
      },
      upsertKeybinding: (input: ServerUpsertKeybindingInput) =>
        session.client.callUnary(WS_METHODS.serverUpsertKeybinding, input) as Promise<
          ServerUpsertKeybindingResult
        >,
      getSettings: () =>
        session.client.callUnary(WS_METHODS.serverGetSettings, {}) as Promise<ServerSettings>,
      updateSettings: (patch: ServerSettingsPatch) =>
        session.client.callUnary(WS_METHODS.serverUpdateSettings, { patch }) as Promise<
          ServerSettings
        >,
    },
    orchestration: orchestrationHandle.orchestration,
  };
}
