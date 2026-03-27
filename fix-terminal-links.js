const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');

file = file.replace(
  "import { WebLinksAddon } from '@xterm/addon-web-links'",
  "import { extractTerminalLinks, isTerminalLinkActivation, resolvePathLinkTarget } from '@/lib/terminalLinks'\nimport { useProjectStore } from '@/stores/useProjectStore'"
);

const oldWebLinksAddon = "term.loadAddon(new WebLinksAddon())";

const newWebLinksAddon = `    const projectPath = useProjectStore.getState().currentProject?.path || ''
    
    const terminalLinksDisposable = term.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const activeTerminal = xtermRef.current
        if (!activeTerminal) {
          callback(undefined)
          return
        }

        const line = activeTerminal.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) {
          callback(undefined)
          return
        }

        const lineText = line.translateToString(true)
        const matches = extractTerminalLinks(lineText)
        if (matches.length === 0) {
          callback(undefined)
          return
        }

        callback(
          matches.map((match) => ({
            text: match.text,
            range: {
              start: { x: match.start + 1, y: bufferLineNumber },
              end: { x: match.end, y: bufferLineNumber },
            },
            activate: (event: MouseEvent, text: string) => {
              if (!isTerminalLinkActivation(event)) return

              if (match.kind === 'url') {
                void window.electronAPI.shell.openExternal(match.text)
                return
              }

              const target = resolvePathLinkTarget(match.text, projectPath)
              const [filePath, lineStr] = target.split(':')
              const line = lineStr ? parseInt(lineStr, 10) : undefined

              void window.electronAPI.editor.listAvailableEditors().then((editors) => {
                 const editor = editors[0]
                 if (editor) {
                    void window.electronAPI.editor.openInEditor({
                       editorId: editor.id,
                       filePath,
                       line
                    })
                 } else {
                    void window.electronAPI.shell.openExternal(\`file://\${filePath}\`)
                 }
              })
            },
          })),
        )
      },
    })`;

file = file.replace(oldWebLinksAddon, newWebLinksAddon);

const oldCleanup = "      selectionDisposable.dispose()";
const newCleanup = "      terminalLinksDisposable.dispose()\n      selectionDisposable.dispose()";

file = file.replace(oldCleanup, newCleanup);

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', file);
