import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

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

export function ensureMonacoEnvironment(): void {
  if (initialized) return
  initialized = true

  if (typeof self !== 'undefined') {
    self.MonacoEnvironment = {
      getWorker(_, label) {
        if (label === 'json') {
          return new jsonWorker()
        }
        if (label === 'css' || label === 'scss' || label === 'less') {
          return new cssWorker()
        }
        if (label === 'html' || label === 'handlebars' || label === 'razor') {
          return new htmlWorker()
        }
        if (label === 'typescript' || label === 'javascript') {
          return new tsWorker()
        }

        if (label === 'TextMateWorker') {
          return new Worker(new URL('@codingame/monaco-vscode-textmate-service-override/worker', import.meta.url), {
            type: 'module',
          })
        }

        return new editorWorker()
      },
    }
  }

  applyTypeScriptValidationConfig(monaco)

  loader.config({ monaco })
}
