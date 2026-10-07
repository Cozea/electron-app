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

  it('handles rapid concurrent setLastWorkbenchRoute calls without ENOENT or corruption', async () => {
    const store = new DesktopBootstrapStore()
    const routes = Array.from({ length: 15 }, (_, index) => ({
      ...routeFixture(),
      laneId: `lane_${index}`,
      updatedAt: 1000 + index,
    }))

    await expect(
      Promise.all(routes.map((route) => store.setLastWorkbenchRoute(route))),
    ).resolves.toBeDefined()

    const snapshot = await store.getInitialSnapshot()
    expect(snapshot.lastWorkbenchRoute).not.toBeNull()
    expect(snapshot.lastWorkbenchRoute?.laneId).toBe('lane_14')
  })

  it('initializes and persists presentation without a cloud session or secure token storage', async () => {
    electronState.encryptionAvailable = false
    const identity = { identityKey: 'czd_00000000000000000000000000', platform: 'darwin' }
    const store = new DesktopBootstrapStore(async () => identity)
    const initial = await store.getLocalDevice()
    expect(initial).toMatchObject({ ...identity, presentationConfigured: false })
    expect(initial).not.toHaveProperty('principalId')
    const configured = await store.updateLocalDevice({ ...identity, displayName: '  Offline Mac  ', avatarUrl: null })
    expect(configured).toMatchObject({ ...identity, displayName: 'Offline Mac', presentationConfigured: true })
    const restarted = new DesktopBootstrapStore(async () => identity)
    expect(await restarted.getLocalDevice()).toEqual(configured)
    expect((await restarted.getInitialSnapshot()).session).toBeNull()
    expect((await restarted.getInitialSnapshot()).localDevice).toEqual(configured)
    const raw = fs.readFileSync(path.join(electronState.root, 'desktop-local-device.v1.json'), 'utf8')
    expect(raw).not.toMatch(/principalId|accessToken|privateKey/)
  })

  it('migrates cached presentation only when it matches the actual installation identity', async () => {
    const session = sessionFixture()
    const store = new DesktopBootstrapStore(async () => ({ identityKey: session.user.identityKey, platform: 'darwin' }))
    await store.storeSession(session)
    const device = await store.getLocalDevice()
    expect(device).toMatchObject({ displayName: session.user.displayName, presentationConfigured: true })
    expect(device).not.toHaveProperty('principalId')
    const replacementIdentity = { identityKey: 'czd_10000000000000000000000000', platform: 'darwin' }
    const replaced = new DesktopBootstrapStore(async () => replacementIdentity)
    expect(await replaced.getLocalDevice()).toMatchObject({ ...replacementIdentity, displayName: 'This Device', presentationConfigured: false })
    await expect(replaced.updateLocalDevice({ identityKey: device.identityKey, displayName: 'Wrong device' })).rejects.toThrow('identity changed')
  })

  it('bounds presentation writes and recovers a corrupt or credential-bearing local file', async () => {
    const identity = { identityKey: 'czd_00000000000000000000000000', platform: 'darwin' }
    const store = new DesktopBootstrapStore(async () => identity)
    for (const update of [
      { displayName: '' }, { displayName: 'x'.repeat(81) }, { displayName: 'bad\nname' },
      { displayName: 'Device', avatarUrl: 'file:///private/key' },
      { displayName: 'Device', avatarUrl: 'https://credential:secret@example.com/avatar' },
      { displayName: 'Device', avatarUrl: `data:image/png;base64,${'a'.repeat(2_000_000)}` },
    ]) {
      await expect(store.updateLocalDevice({ identityKey: identity.identityKey, ...update })).rejects.toThrow('Invalid local device presentation')
    }
    const safe = await store.getLocalDevice()
    const file = path.join(electronState.root, 'desktop-local-device.v1.json')
    fs.writeFileSync(file, JSON.stringify({ ...safe, accessToken: 'unexpected' }))
    expect((await store.getInitialSnapshot()).localDevice).toBeNull()
    expect(await store.getLocalDevice()).toEqual(expect.objectContaining({ presentationConfigured: false }))
    expect(fs.readFileSync(file, 'utf8')).not.toContain('accessToken')
    fs.writeFileSync(file, '{broken')
    expect(await store.getLocalDevice()).toMatchObject(identity)
  })

  it('serializes concurrent local name updates without losing an unchanged avatar', async () => {
    const identity = { identityKey: 'czd_00000000000000000000000000', platform: 'darwin' }
    const store = new DesktopBootstrapStore(async () => identity)
    const avatarUrl = 'data:image/png;base64,YQ=='
    await store.updateLocalDevice({ identityKey: identity.identityKey, displayName: 'First', avatarUrl })
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      store.updateLocalDevice({ identityKey: identity.identityKey, displayName: `Device ${index}` })))
    expect(await store.getLocalDevice()).toMatchObject({ displayName: 'Device 7', avatarUrl })
  })
})
