import { BrowserWindow } from 'electron'

export interface ExternalFileChangePayload {
  filePath: string
  content: string
  origin?: string
}

export interface ExternalFileDeletePayload {
  filePath: string
  origin?: string
}

export function notifyFileChanged(
  filePath: string,
  content: string,
  options?: { origin?: string }
): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    const payload: ExternalFileChangePayload = {
      filePath,
      content,
      origin: options?.origin,
    }
    window.webContents.send('yjs:external-file-change', payload)
  })
}

export function notifyFileDeleted(
  filePath: string,
  options?: { origin?: string }
): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    const payload: ExternalFileDeletePayload = {
      filePath,
      origin: options?.origin,
    }
    window.webContents.send('yjs:external-file-delete', payload)
  })
}
