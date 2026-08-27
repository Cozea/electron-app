import { ipcMain } from 'electron'

import {
  createRecoveryKit,
  deleteCollabDeviceIdentity,
  ensureCollabDeviceIdentity,
  getStoredCollabDeviceIdentitySummary,
  isCollabEncryptionAvailable,
  unwrapRoomKeyFromRecoveryKit,
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

    ipcMain.handle(
      'collab:createRecoveryKit',
      async (
        _event,
        options: { roomKeyBase64: string; recoveryCode?: string },
      ) => {
        return await createRecoveryKit(options)
      },
    )

    ipcMain.handle(
      'collab:unwrapRecoveryKit',
      async (
        _event,
        options: {
          recoveryCode: string
          wrappedKey: string
          salt: string
          iterations: number
          wrapAlgorithm?: string
        },
      ) => {
        return await unwrapRoomKeyFromRecoveryKit(options)
      },
    )

    ipcMain.handle('collab:deleteDeviceIdentity', () => {
      return deleteCollabDeviceIdentity()
    })
  }
}
