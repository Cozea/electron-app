import { ipcMain } from 'electron'

import {
  deleteCollabDeviceIdentity,
  ensureCollabDeviceIdentity,
  getStoredCollabDeviceIdentitySummary,
  isCollabEncryptionAvailable,
  unwrapRoomKeyFromSender,
  wrapRoomKeyForRecipient,
} from '../collabKeys'

export class CollabEncryptionService {
  private static instance: CollabEncryptionService

  private constructor() {}

  static getInstance(): CollabEncryptionService {
    if (!CollabEncryptionService.instance) {
      CollabEncryptionService.instance = new CollabEncryptionService()
    }
    return CollabEncryptionService.instance
  }

  registerIpcHandlers(): void {
    ipcMain.handle('collab:isEncryptionAvailable', () => {
      return isCollabEncryptionAvailable()
    })

    ipcMain.handle('collab:ensureDeviceIdentity', async () => {
      return await ensureCollabDeviceIdentity()
    })

    ipcMain.handle('collab:getStoredDeviceIdentity', () => {
      return getStoredCollabDeviceIdentitySummary()
    })

    ipcMain.handle(
      'collab:wrapRoomKey',
      async (
        _event,
        options: { roomKeyBase64: string; recipientPublicKeyJwk: string },
      ) => {
        return await wrapRoomKeyForRecipient(options)
      },
    )

    ipcMain.handle(
      'collab:unwrapRoomKey',
      async (
        _event,
        options: { senderPublicKeyJwk: string; wrappedKey: string; wrapAlgorithm?: string },
      ) => {
        return await unwrapRoomKeyFromSender(options)
      },
    )

    ipcMain.handle('collab:deleteDeviceIdentity', () => {
      return deleteCollabDeviceIdentity()
    })
  }
}
