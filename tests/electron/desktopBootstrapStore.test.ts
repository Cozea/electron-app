import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({
  root: '',
  encryptionAvailable: true,
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`Unexpected app path: ${name}`)
      return electronState.root
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => electronState.encryptionAvailable,
    encryptString: (value: string) =>
      Buffer.from(`enc:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (encrypted: Buffer) => {
      const encoded = encrypted.toString('utf8')
      if (!encoded.startsWith('enc:')) throw new Error('invalid encrypted fixture')
      return Buffer.from(encoded.slice(4), 'base64').toString('utf8')
    },
  },
}))

import type {
  DesktopBootstrapSession,
  DesktopWorkbenchLocator,
} from '../../shared/desktopBootstrapTypes'
import { DesktopBootstrapStore } from '../../apps/desktop/electron/services/DesktopBootstrapStore'

function sessionFixture(): DesktopBootstrapSession {
  return {
    accessToken: 'secret-access-token',
    expiresAt: 2_000_000_000,
    principalId: 'principal_1',
    user: {
      principalId: 'principal_1',
      identityKey: 'czd_00000000000000000000000000',
      displayName: 'Test device',
      presentationConfigured: true,
      avatarUrl: null,
      platform: 'darwin',
    },
    personalWorkspace: {
      id: 'membership-1',
      workspaceId: 'workspace_personal_1',
      workspaceName: 'Personal',
      organizationId: 'org-personal-1',
      organizationName: 'Personal',
      role: 'admin',
      status: 'active',
      workspaceType: 'personal',
      iconKey: null,
      iconColor: null,
      logoUrl: null,
    },
  }
}

function routeFixture(): DesktopWorkbenchLocator {
  return {
    workspaceSelectionId: 'czd_00000000000000000000000000',
    projectId: 'project_1',
    laneId: 'collab',
    focusTileId: 'tile_1',
    updatedAt: 1234,
  }
}

beforeEach(() => {
  electronState.root = fs.mkdtempSync(path.join(os.tmpdir(), 'cozea-desktop-bootstrap-'))
  electronState.encryptionAvailable = true
})

afterEach(() => {
  fs.rmSync(electronState.root, { recursive: true, force: true })
})

describe('DesktopBootstrapStore', () => {
  it('round-trips the secure session and last workbench without storing the token as plaintext', async () => {
    const store = new DesktopBootstrapStore()
    const session = sessionFixture()
    const route = routeFixture()

    await store.storeSession(session)
    await store.setLastWorkbenchRoute(route)

    const snapshot = await store.getInitialSnapshot()
    expect(snapshot.session).toEqual(session)
    expect(snapshot.lastWorkbenchRoute).toEqual(route)

    const encrypted = fs.readFileSync(
      path.join(electronState.root, 'desktop-bootstrap-session.v2.enc'),
      'utf8',
    )
    expect(encrypted).not.toContain(session.accessToken)
  })

  it('treats corrupt local bootstrap files as missing instead of blocking launch', async () => {
    fs.writeFileSync(path.join(electronState.root, 'desktop-bootstrap-session.v2.enc'), 'garbage')
    fs.writeFileSync(path.join(electronState.root, 'desktop-bootstrap-navigation.v1.json'), '{broken')

    const snapshot = await new DesktopBootstrapStore().getInitialSnapshot()

    expect(snapshot.session).toBeNull()
    expect(snapshot.lastWorkbenchRoute).toBeNull()
  })

  it('rejects encrypted session payloads that no longer match the runtime contract', async () => {
    const malformed = {
      ...sessionFixture(),
      user: { principalId: 'principal_1' },
    }
    const encrypted = Buffer.from(
      `enc:${Buffer.from(JSON.stringify(malformed), 'utf8').toString('base64')}`,
      'utf8',
    )
    fs.writeFileSync(path.join(electronState.root, 'desktop-bootstrap-session.v2.enc'), encrypted)

    expect((await new DesktopBootstrapStore().getInitialSnapshot()).session).toBeNull()
  })

  it('refuses plaintext session persistence when secure storage is unavailable', async () => {
    electronState.encryptionAvailable = false
    const store = new DesktopBootstrapStore()

    await expect(store.storeSession(sessionFixture())).rejects.toThrow('Secure storage is unavailable')
    expect((await store.getInitialSnapshot()).session).toBeNull()
    expect(fs.existsSync(path.join(electronState.root, 'desktop-bootstrap-session.v2.enc'))).toBe(false)
  })

  it('clears only the matching persisted workbench locator', async () => {
    const store = new DesktopBootstrapStore()
    const route = routeFixture()
    await store.setLastWorkbenchRoute(route)

    await store.clearLastWorkbenchRoute('some-other-device')
    expect((await store.getInitialSnapshot()).lastWorkbenchRoute).toEqual(route)

    await store.clearLastWorkbenchRoute(route.workspaceSelectionId)
    expect((await store.getInitialSnapshot()).lastWorkbenchRoute).toBeNull()
  })
})
