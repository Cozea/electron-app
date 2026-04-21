import { ensureVscodeFileSystemBridgeInitialized, getVscodeWorkspaceProjectPath } from "@/lib/editor/vscodeFileSystemBridge";

let initializationPromise: Promise<void> | null = null;

function isDiagnosticsDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage?.getItem("vscodeDiagnosticsDebug") === "1";
}

export function ensureVscodeServicesInitialized(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise;
  }

  ensureVscodeFileSystemBridgeInitialized();

  initializationPromise = (async () => {
    const [
      { initialize },
      { default: getExtensionsServiceOverride },
      { default: getFilesServiceOverride },
      { default: getLanguagesServiceOverride },
      { default: getThemeServiceOverride },
      { default: getTextMateServiceOverride },
      { URI },
    ] = await Promise.all([
      import("@codingame/monaco-vscode-api"),
      import("@codingame/monaco-vscode-extensions-service-override"),
      import("@codingame/monaco-vscode-files-service-override"),
      import("@codingame/monaco-vscode-languages-service-override"),
      import("@codingame/monaco-vscode-theme-service-override"),
      import("@codingame/monaco-vscode-textmate-service-override"),
      import("@codingame/monaco-vscode-api/vscode/vs/base/common/uri"),
      import("@codingame/monaco-vscode-theme-defaults-default-extension"),
      import("@codingame/monaco-vscode-json-default-extension"),
      import("@codingame/monaco-vscode-css-default-extension"),
      import("@codingame/monaco-vscode-html-default-extension"),
      import("@codingame/monaco-vscode-javascript-default-extension"),
      import("@codingame/monaco-vscode-typescript-basics-default-extension"),
      import("@codingame/monaco-vscode-typescript-language-features-default-extension"),
      import("vscode/localExtensionHost"),
    ]);

    const workspaceProvider = {
      get workspace() {
        const projectPath = getVscodeWorkspaceProjectPath();
        if (projectPath && isDiagnosticsDebugEnabled()) {
          console.debug("[VSCode] Workspace provider path", projectPath);
        }
        return projectPath ? { folderUri: URI.file(projectPath) } : undefined;
      },
      trusted: true,
      open: async () => false,
    };

    if (isDiagnosticsDebugEnabled()) {
      console.debug("[VSCode] Initializing services");
    }

    await initialize(
      {
        ...getExtensionsServiceOverride({ enableWorkerExtensionHost: false }),
        ...getFilesServiceOverride(),
        ...getTextMateServiceOverride(),
        ...getThemeServiceOverride(),
        ...getLanguagesServiceOverride(),
      },
      undefined,
      {
        workspaceProvider,
        configurationDefaults: {
          "typescript.validate.enable": true,
          "javascript.validate.enable": true,
        },
      },
    );

    if (isDiagnosticsDebugEnabled()) {
      console.debug("[VSCode] Services initialized");
    }
  })().catch((error) => {
    initializationPromise = null;
    console.error("[Monaco] Failed to initialize VS Code services", error);
    throw error;
  });

  return initializationPromise;
}
