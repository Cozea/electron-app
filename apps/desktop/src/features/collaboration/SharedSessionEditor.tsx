import { useEffect, useRef, useState } from "react"
import * as Y from "yjs"
import { EditorState } from "@codemirror/state"
import { EditorView, lineNumbers, keymap, drawSelection } from "@codemirror/view"
import { javascript } from "@codemirror/lang-javascript"
import { sessionEditorBridge } from "./runtime/SessionEditorBridge"

interface SharedSessionEditorProps { sessionId: string; path: string; readOnly: boolean }

/** A view of the Electron-owned CRDT. This component owns no room transport or keys. */
export function SharedSessionEditor({ sessionId, path, readOnly }: SharedSessionEditorProps) {
  const element = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const api = window.electronAPI.collaboration.runtime
    const doc = new Y.Doc({ gc: false })
    let view: EditorView | null = null
    let alive = true, applying = false
    let writes = Promise.resolve()
    let unsubscribe: (() => void) | undefined
    let anchor: Y.RelativePosition | null = null, head: Y.RelativePosition | null = null
    void (async () => {
      const file = await api.openFile({ sessionId, path })
      Y.applyUpdate(doc, await api.editorState(sessionId), "main")
      if (!alive || !element.current) return
      const text = doc.getText(`file-content:${file.id}`)
      const undo = new Y.UndoManager(text, { trackedOrigins: new Set(["local-editor"]) })
      view = new EditorView({ parent: element.current, state: EditorState.create({ doc: text.toString(), extensions: [
        lineNumbers(), drawSelection(), keymap.of([
          { key: "Mod-z", run: () => { if (readOnly) return false; undo.undo(); return true } },
          { key: "Mod-Shift-z", run: () => { if (readOnly) return false; undo.redo(); return true } },
        ]), javascript({ typescript: true, jsx: true }),
        EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
        EditorView.theme({ "&": { height: "100%", fontSize: "12px" }, ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)" } }),
        EditorView.updateListener.of(update => {
          if (!update.docChanged || applying || readOnly) return
          doc.transact(() => {
            let offset = 0
            update.changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
              text.delete(from + offset, to - from)
              text.insert(from + offset, inserted.toString())
              offset += inserted.length - (to - from)
            })
          }, "local-editor")
        }),
      ] }) })
      doc.on("beforeTransaction", transaction => {
        if (transaction.origin === "local-editor" || !view) return
        anchor = Y.createRelativePositionFromTypeIndex(text, view.state.selection.main.anchor)
        head = Y.createRelativePositionFromTypeIndex(text, view.state.selection.main.head)
      })
      text.observe(() => {
        if (!view || view.state.doc.toString() === text.toString()) return
        const a = anchor ? Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index : undefined
        const h = head ? Y.createAbsolutePositionFromRelativePosition(head, doc)?.index : undefined
        applying = true
        try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text.toString() },
          ...(a !== undefined && h !== undefined ? { selection: { anchor: a, head: h } } : {}) }) }
        finally { applying = false }
      })
      doc.on("update", (update, origin) => {
        if (origin !== "local-editor" && origin !== undo) return
        const saved = update.slice()
        writes = sessionEditorBridge.enqueue(sessionId, saved).then(() => { if (alive) setError(null) }).catch(() => { if (alive) setError("Edits are waiting to be saved. Keep Cozea open and retry synchronization before leaving.") })
      })
      unsubscribe = api.onChanged(id => {
        if (id !== sessionId) return
        void api.editorState(sessionId).then(update => { if (alive) Y.applyUpdate(doc, update, "main") }).catch(() => { if (alive) setError("Session disconnected. Local recovery is retained.") })
      })
    })().catch(error => { if (alive) setError(error instanceof Error ? error.message : "File could not be opened") })
    return () => { alive = false; unsubscribe?.(); view?.destroy(); void writes.finally(() => doc.destroy()) }
  }, [sessionId, path, readOnly])
  return <div className="flex h-full min-h-64 flex-col overflow-hidden rounded-md border">
    <div className="border-b px-3 py-1 text-xs text-muted-foreground">{path}{readOnly ? " · Observer" : ""}</div>
    {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
    <div ref={element} className="min-h-0 flex-1" />
  </div>
}
