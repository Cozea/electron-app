import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

let initialized = false

type MonacoTsDefaults = {
  setDiagnosticsOptions: (options: { noSemanticValidation: boolean; noSyntaxValidation: boolean }) => void
  setEagerModelSync?: (enabled: boolean) => void
}

const ENABLE_MONACO_SYNTAX_VALIDATION = true
const ENABLE_MONACO_SEMANTIC_VALIDATION = false

function applyTypeScriptValidationConfig(monacoInstance: typeof monaco): void {
  const typescriptLanguage = (monacoInstance as unknown as {
    languages?: {
      typescript?: {
        typescriptDefaults?: MonacoTsDefaults
        javascriptDefaults?: MonacoTsDefaults
      }
    }
  }).languages?.typescript

  if (!typescriptLanguage?.typescriptDefaults || !typescriptLanguage?.javascriptDefaults) {
    return
  }

  typescriptLanguage.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: !ENABLE_MONACO_SEMANTIC_VALIDATION,
    noSyntaxValidation: !ENABLE_MONACO_SYNTAX_VALIDATION,
  })
  typescriptLanguage.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: !ENABLE_MONACO_SEMANTIC_VALIDATION,
    noSyntaxValidation: !ENABLE_MONACO_SYNTAX_VALIDATION,
  })

  typescriptLanguage.typescriptDefaults.setEagerModelSync?.(true)
  typescriptLanguage.javascriptDefaults.setEagerModelSync?.(true)
}

export function configureMonacoTypeScriptValidation(monacoInstance: typeof monaco): void {
  applyTypeScriptValidationConfig(monacoInstance)
}

function createMonacoWorker(label: string): Worker {
  // Use explicit module workers instead of Vite's `?worker` shorthand.
  // The `?worker` + iife format is incompatible with Vite 7/Rolldown code-splitting builds.
  if (label === 'json') {
    return new Worker(
      new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url),
      { type: 'module' }
    )
  }
  if (label === 'css' || label === 'scss' || label === 'less') {
    return new Worker(
      new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url),
      { type: 'module' }
    )
  }
  if (label === 'html' || label === 'handlebars' || label === 'razor') {
    return new Worker(
      new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url),
      { type: 'module' }
    )
  }
  if (label === 'typescript' || label === 'javascript') {
    return new Worker(
      new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url),
      { type: 'module' }
    )
  }
  if (label === 'TextMateWorker') {
    return new Worker(
      new URL('@codingame/monaco-vscode-textmate-service-override/worker', import.meta.url),
      { type: 'module' }
    )
  }
  // Default editor worker
  return new Worker(
    new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
    { type: 'module' }
  )
}

export function ensureMonacoEnvironment(): void {
  if (initialized) return
  initialized = true

  if (typeof self !== 'undefined') {
    self.MonacoEnvironment = {
      getWorker(_, label) {
        return createMonacoWorker(label)
      },
    }
  }

  applyTypeScriptValidationConfig(monaco)

  loader.config({ monaco })
}
