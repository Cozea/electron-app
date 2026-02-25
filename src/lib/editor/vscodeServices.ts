import '@codingame/monaco-vscode-theme-defaults-default-extension'
import '@codingame/monaco-vscode-json-default-extension'
import '@codingame/monaco-vscode-css-default-extension'
import '@codingame/monaco-vscode-html-default-extension'
import '@codingame/monaco-vscode-javascript-default-extension'
import '@codingame/monaco-vscode-typescript-basics-default-extension'
import '@codingame/monaco-vscode-typescript-language-features-default-extension'
import 'vscode/localExtensionHost'

import { initialize } from '@codingame/monaco-vscode-api'
import getExtensionsServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
import getFilesServiceOverride from '@codingame/monaco-vscode-files-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getTextMateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import { ensureVscodeFileSystemBridgeInitialized, getVscodeWorkspaceProjectPath } from '@/lib/editor/vscodeFileSystemBridge'

let initializationPromise: Promise<void> | null = null

function isDiagnosticsDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return window.localStorage?.getItem('vscodeDiagnosticsDebug') === '1'
}

export function ensureVscodeServicesInitialized(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise
  }

  ensureVscodeFileSystemBridgeInitialized()

  const workspaceProvider = {
    get workspace() {
      const projectPath = getVscodeWorkspaceProjectPath()
      if (projectPath && isDiagnosticsDebugEnabled()) {
        console.debug('[VSCode] Workspace provider path', projectPath)
      }
      return projectPath ? { folderUri: URI.file(projectPath) } : undefined
    },
    trusted: true,
    open: async () => false,
  }

  if (isDiagnosticsDebugEnabled()) {
    console.debug('[VSCode] Initializing services')
  }

  initializationPromise = initialize({
    ...getExtensionsServiceOverride({ enableWorkerExtensionHost: false }),
    ...getFilesServiceOverride(),
    ...getTextMateServiceOverride(),
    ...getThemeServiceOverride(),
    ...getLanguagesServiceOverride(),
  }, undefined, {
    workspaceProvider,
    configurationDefaults: {
      'typescript.validate.enable': true,
      'javascript.validate.enable': true,
    },
  })
    .then(() => {
      if (isDiagnosticsDebugEnabled()) {
        console.debug('[VSCode] Services initialized')
      }
    })
    .catch((error) => {
    initializationPromise = null
    console.error('[Monaco] Failed to initialize VS Code services', error)
    throw error
  })

  return initializationPromise
}
