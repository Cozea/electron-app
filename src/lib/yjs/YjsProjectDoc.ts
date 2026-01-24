import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'

export class YjsProjectDoc {
  readonly doc: Y.Doc
  readonly files: Y.Map<Y.Text>
  readonly awareness: Awareness

  constructor(projectId: string) {
    this.doc = new Y.Doc({ guid: projectId })
    this.files = this.doc.getMap('files')
    this.awareness = new Awareness(this.doc)
  }

  getFileText(path: string): Y.Text {
    if (!this.files.has(path)) {
      this.files.set(path, new Y.Text())
    }
    return this.files.get(path)!
  }

  initializeFile(path: string, content: string): void {
    const yText = this.getFileText(path)
    this.doc.transact(() => {
      yText.delete(0, yText.length)
      yText.insert(0, content)
    }, 'init')
  }

  applyExternalChange(path: string, newContent: string): void {
    const yText = this.getFileText(path)
    if (yText.toString() === newContent) return
    this.doc.transact(() => {
      yText.delete(0, yText.length)
      yText.insert(0, newContent)
    }, 'agent')
  }

  destroy(): void {
    this.awareness.destroy()
    this.doc.destroy()
  }
}
