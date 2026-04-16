import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { invalidateCollabSession, useCollabSession } from '@/hooks/useCollabSession'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { ProjectDeleteDialog } from '@/features/projects/components/ProjectDeleteDialog'
import { formatProjectDeleteError } from '@/features/projects/lib/projectMutationPresentation'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { EncryptedLocalSnapshotStore } from '@/lib/collab/EncryptedLocalSnapshotStore'
import {
  bytesToEnvelope,
  decryptPayload,
  encryptPayload,
  envelopeToBytes,
  generateRoomKeyBase64,
} from '@/lib/collab/cipherEnvelope'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon as __AlertTriangleHugeIcon, Bookmark01Icon as __SaveHugeIcon, Cancel01Icon as __XHugeIcon, Delete02Icon as __Trash2HugeIcon, Refresh01Icon as __Loader2HugeIcon } from '@hugeicons/core-free-icons'

export interface ProjectSettingsPageProps {
  presentation?: 'modal' | 'embedded'
  onRequestClose?: (() => void) | null
}

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '') || fallback
}

interface ActiveRecoveryKit {
  roomId: string
  keyVersion: number
  wrapAlgorithm: string
  wrappedKey: string
  salt: string
  iterations: number
  createdAt: number
  createdByDeviceId: string
}

export function ProjectSettingsPage({
  presentation = 'modal',
  onRequestClose = null,
}: ProjectSettingsPageProps = {}) {
  const unsafeYjsApi = api as any
  const isEmbedded = presentation === 'embedded'
  const navigate = useViewTransitionNavigate()
  const { convexUserId } = useAuth()
  const { project } = useAccessibleProject()

  const updateProject = useMutation(api.projects.update)
  const archiveProject = useMutation(api.projects.archive)
  const removeProject = useMutation(api.projects.deleteProject)
  const revokeCollabDevice = useMutation(api.yjs.revokeCollabDevice)
  const storeWrappedRoomKey = useMutation(api.yjs.storeWrappedRoomKey)
  const storeRecoveryKit = useMutation(unsafeYjsApi.yjs.storeRecoveryKit)
  const syncCollabRoom = useMutation(api.yjs.syncWithServer)
  const rotateEncryptedRoomKey = useMutation(api.yjs.rotateEncryptedRoomKey)
  const resetEncryptedRoom = useMutation(api.yjs.resetEncryptedRoom)

  const memberRole = useQuery(
    api.projectMembers.getMemberRole,
    project?._id && convexUserId
      ? { projectId: project._id, userId: convexUserId }
      : 'skip'
  )
  const collabSessionResult = useCollabSession({
    projectId: project?._id ? String(project._id) : null,
    enabled: Boolean(project?._id),
  })
  const collaborationDevices = useQuery(
    api.yjs.listCollabRoomDevices,
    project?._id && collabSessionResult.session?.roomId
      ? { projectId: project._id, roomId: collabSessionResult.session.roomId }
      : 'skip',
  )
  const pendingKeyRequests = useQuery(
    api.yjs.listPendingKeyRequests,
    project?._id && collabSessionResult.session?.roomId
      ? { projectId: project._id, roomId: collabSessionResult.session.roomId }
      : 'skip',
  )
  const activeRecoveryKit = useQuery(
    unsafeYjsApi.yjs.getActiveRecoveryKit,
    project?._id && collabSessionResult.session?.roomId
      ? { projectId: project._id, roomId: collabSessionResult.session.roomId }
      : 'skip',
  ) as ActiveRecoveryKit | null | undefined

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showCollabResetDialog, setShowCollabResetDialog] = useState(false)
  const [showRecoveryCodeDialog, setShowRecoveryCodeDialog] = useState(false)
  const [generatedRecoveryCode, setGeneratedRecoveryCode] = useState<string | null>(null)
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('')
  const [collabAction, setCollabAction] = useState<"share" | "rotate" | "reset" | "generate-recovery" | "recover" | `revoke:${string}` | null>(null)
  const [collabError, setCollabError] = useState<string | null>(null)
  const [collabNotice, setCollabNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return
    setName(project.name ?? '')
    setDescription(project.description ?? '')
    setSaveError(null)
    setArchiveError(null)
    setDeleteError(null)
    setCollabError(null)
    setCollabNotice(null)
    setGeneratedRecoveryCode(null)
    setRecoveryCodeInput('')
  }, [
    project?._id,
    project?.description,
    project?.name,
    project,
  ])

  const isManager = memberRole === 'project_manager'
  const canEditGeneral = memberRole !== null && memberRole !== undefined && memberRole !== 'viewer'

  const projectName = project?.name ?? ''
  const projectDescription = project?.description ?? ''
  const hasChanges = Boolean(project) && (
    name !== projectName ||
    description !== projectDescription
  )
  const canSave = Boolean(convexUserId) && canEditGeneral && !isSaving && hasChanges && name.trim().length > 0
  const collabSession = collabSessionResult.session
  const collabBootstrap = collabSession?.encryption ?? null
  const currentDeviceId = collabSession?.deviceId ?? null
  const collabScopeKey = project?._id ? String(project._id) : null
  const canManageCollabSecurity = Boolean(project?._id && convexUserId && canEditGeneral)
  const pendingRequestCount = pendingKeyRequests?.filter((request) => typeof request.fulfilledAt !== 'number').length ?? 0

  const buildAndStoreRecoveryKit = useCallback(async (args: {
    roomKeyBase64: string
    keyVersion: number
  }): Promise<string | null> => {
    if (!project || !convexUserId || !collabSession) {
      return null
    }

    const recoveryKit = await window.electronAPI.collab.createRecoveryKit({
      roomKeyBase64: args.roomKeyBase64,
    })

    await storeRecoveryKit({
      projectId: project._id,
      roomId: collabSession.roomId,
      keyVersion: args.keyVersion,
      createdByUserId: convexUserId,
      createdByDeviceId: collabSession.deviceId,
      wrapAlgorithm: recoveryKit.wrapAlgorithm,
      wrappedKey: recoveryKit.wrappedKey,
      salt: recoveryKit.salt,
      iterations: recoveryKit.iterations,
    })

    setGeneratedRecoveryCode(recoveryKit.recoveryCode)
    setShowRecoveryCodeDialog(true)
    return recoveryKit.recoveryCode
  }, [collabSession, convexUserId, project, storeRecoveryKit])

  const rotateRoomKeyWithCurrentRoom = useCallback(async (options?: {
    devices?: NonNullable<typeof collaborationDevices>
  }): Promise<number | null> => {
    if (
      !project ||
      !convexUserId ||
      !collabSession ||
      !collabBootstrap ||
      collabBootstrap.status !== 'ready' ||
      !collabBootstrap.wrappedRoomKey ||
      !collabBootstrap.senderPublicKeyJwk
    ) {
      return null
    }

    const devices = options?.devices ?? collaborationDevices
    if (!devices || devices.length === 0) {
      throw new Error('No active trusted devices are available for key rotation.')
    }

    const { roomKeyBase64: currentRoomKeyBase64 } = await window.electronAPI.collab.unwrapRoomKey({
      senderPublicKeyJwk: collabBootstrap.senderPublicKeyJwk,
      wrappedKey: collabBootstrap.wrappedRoomKey,
      wrapAlgorithm: collabBootstrap.wrapAlgorithm ?? undefined,
    })

    const syncState = await syncCollabRoom({
      projectId: project._id,
      clientId: `settings-rotation:${Date.now()}`,
      roomId: collabSession.roomId,
    })

    const roomDoc = new Y.Doc()
    if (syncState.serverSnapshot) {
      const decryptedSnapshot = await decryptPayload({
        roomKeyBase64: currentRoomKeyBase64,
        envelope: bytesToEnvelope(new Uint8Array(syncState.serverSnapshot)),
        expectedKind: 'yjs_snapshot',
      })
      Y.applyUpdate(roomDoc, decryptedSnapshot, 'snapshot')
    }
    for (const update of syncState.recentUpdates) {
      const decryptedUpdate = await decryptPayload({
        roomKeyBase64: currentRoomKeyBase64,
        envelope: bytesToEnvelope(new Uint8Array(update.update)),
        expectedKind: 'yjs_update',
      })
      Y.applyUpdate(roomDoc, decryptedUpdate, 'snapshot')
    }

    const nextKeyVersion = (collabBootstrap.activeKeyVersion ?? 1) + 1
    const nextRoomKeyBase64 = generateRoomKeyBase64()
    const nextSnapshotEnvelope = await encryptPayload({
      roomKeyBase64: nextRoomKeyBase64,
      kind: 'yjs_snapshot',
      keyVersion: nextKeyVersion,
      plaintext: Y.encodeStateAsUpdate(roomDoc),
      metadata: {
        projectId: String(project._id),
        roomId: collabSession.roomId,
      },
    })

    const wrappedKeys: Array<{
      recipientUserId: NonNullable<typeof devices>[number]['userId']
      recipientDeviceId: string
      senderPublicKeyJwk: string
      wrapAlgorithm: string
      wrappedKey: string
    }> = []

    for (const device of devices) {
      if (device.revokedAt || !device.publicKeyJwk) {
        continue
      }

      const wrapped = await window.electronAPI.collab.wrapRoomKey({
        roomKeyBase64: nextRoomKeyBase64,
        recipientPublicKeyJwk: device.publicKeyJwk,
      })

      wrappedKeys.push({
        recipientUserId: device.userId,
        recipientDeviceId: device.deviceId,
        senderPublicKeyJwk: wrapped.senderPublicKeyJwk,
        wrapAlgorithm: wrapped.wrapAlgorithm,
        wrappedKey: wrapped.wrappedKey,
      })
    }

    if (wrappedKeys.length === 0) {
      throw new Error('No active trusted devices are available for key rotation.')
    }

    const nextSnapshotBytes = envelopeToBytes(nextSnapshotEnvelope)
    await rotateEncryptedRoomKey({
      projectId: project._id,
      roomId: collabSession.roomId,
      userId: convexUserId,
      initiatedByDeviceId: collabSession.deviceId,
      encryptedSnapshot: nextSnapshotBytes.slice().buffer,
      createdByClientId: String(roomDoc.clientID),
      wrappedKeys,
    })

    await buildAndStoreRecoveryKit({
      roomKeyBase64: nextRoomKeyBase64,
      keyVersion: nextKeyVersion,
    })

    if (collabScopeKey) {
      const localStore = new EncryptedLocalSnapshotStore()
      await localStore.save({
        scopeKey: collabScopeKey,
        keyVersion: nextKeyVersion,
        envelopeJson: JSON.stringify(nextSnapshotEnvelope),
        updatedAt: Date.now(),
      })
    }

    invalidateCollabSession(String(project._id))
    await collabSessionResult.refresh()

    return nextKeyVersion
  }, [
    buildAndStoreRecoveryKit,
    collabBootstrap,
    collabScopeKey,
    collabSession,
    collabSessionResult,
    collaborationDevices,
    convexUserId,
    project,
    rotateEncryptedRoomKey,
    syncCollabRoom,
  ])

  const handleSave = useCallback(async () => {
    if (!project || !convexUserId) return

    const nextName = name.trim()
    if (!nextName) {
      setSaveError('Project name is required.')
      return
    }
    if (!hasChanges) return

    setIsSaving(true)
    setSaveError(null)

    try {
      await updateProject({
        projectId: project._id,
        userId: convexUserId,
        name: nextName,
        description,
      })
    } catch (error) {
      setSaveError(cleanConvexError(error, 'Failed to save project settings'))
    } finally {
      setIsSaving(false)
    }
  }, [
    convexUserId,
    description,
    hasChanges,
    name,
    project,
    updateProject,
  ])

  const handleArchive = useCallback(async () => {
    if (!project || !convexUserId) return

    setIsArchiving(true)
    setArchiveError(null)
    try {
      await archiveProject({
        projectId: project._id,
        userId: convexUserId,
      })
      setShowArchiveDialog(false)
      navigate('/projects')
    } catch (error) {
      setArchiveError(cleanConvexError(error, 'Failed to archive project'))
    } finally {
      setIsArchiving(false)
    }
  }, [archiveProject, convexUserId, navigate, project])

  const handleDelete = useCallback(async (confirmName: string) => {
    if (!project || !convexUserId || confirmName !== project.name) return

    setIsDeleting(true)
    setDeleteError(null)
    try {
      await removeProject({
        projectId: project._id,
        userId: convexUserId,
        confirmName,
      })
      setShowDeleteDialog(false)
      navigate('/projects')
    } catch (error) {
      const presentation = formatProjectDeleteError(error)
      setDeleteError(
        presentation.detail
          ? `${presentation.message} ${presentation.detail}`
          : presentation.message
      )
    } finally {
      setIsDeleting(false)
    }
  }, [convexUserId, navigate, project, removeProject])

  const handleSharePendingDevices = useCallback(async () => {
    if (
      !project ||
      !collabSession ||
      !collabBootstrap ||
      collabBootstrap.status !== 'ready' ||
      !collabBootstrap.wrappedRoomKey ||
      !collabBootstrap.senderPublicKeyJwk ||
      !pendingKeyRequests ||
      pendingKeyRequests.length === 0
    ) {
      return
    }

    setCollabAction('share')
    setCollabError(null)
    setCollabNotice(null)

    try {
      const { roomKeyBase64 } = await window.electronAPI.collab.unwrapRoomKey({
        senderPublicKeyJwk: collabBootstrap.senderPublicKeyJwk,
        wrappedKey: collabBootstrap.wrappedRoomKey,
        wrapAlgorithm: collabBootstrap.wrapAlgorithm ?? undefined,
      })

      for (const request of pendingKeyRequests) {
        if (typeof request.fulfilledAt === 'number') {
          continue
        }

        const wrapped = await window.electronAPI.collab.wrapRoomKey({
          roomKeyBase64,
          recipientPublicKeyJwk: request.recipientPublicKeyJwk,
        })

        await storeWrappedRoomKey({
          projectId: project._id,
          roomId: collabSession.roomId,
          keyVersion: collabBootstrap.activeKeyVersion ?? 1,
          recipientUserId: request.recipientUserId,
          recipientDeviceId: request.recipientDeviceId,
          senderDeviceId: wrapped.senderDeviceId,
          senderPublicKeyJwk: wrapped.senderPublicKeyJwk,
          wrapAlgorithm: wrapped.wrapAlgorithm,
          wrappedKey: wrapped.wrappedKey,
        })
      }

      setCollabNotice('Pending devices can now join encrypted collaboration.')
      await collabSessionResult.refresh()
    } catch (error) {
      setCollabError(cleanConvexError(error, 'Failed to share encrypted room keys'))
    } finally {
      setCollabAction(null)
    }
  }, [
    collabBootstrap,
    collabSession,
    collabSessionResult,
    pendingKeyRequests,
    project,
    storeWrappedRoomKey,
  ])

  const handleRevokeDevice = useCallback(async (deviceId: string) => {
    if (!project || !collabSession) {
      return
    }

    setCollabAction(`revoke:${deviceId}`)
    setCollabError(null)
    setCollabNotice(null)

    try {
      await revokeCollabDevice({
        projectId: project._id,
        roomId: collabSession.roomId,
        deviceId,
      })
      if (collabBootstrap?.status === 'ready' && collaborationDevices) {
        const nextDevices = collaborationDevices.map((device) =>
          device.deviceId === deviceId
            ? { ...device, revokedAt: Date.now() }
            : device,
        )
        await rotateRoomKeyWithCurrentRoom({
          devices: nextDevices,
        })
        setCollabNotice('Device access revoked and the shared room key was rotated automatically.')
      } else {
        setCollabNotice('Device access revoked for future encrypted collaboration.')
      }
      await collabSessionResult.refresh()
    } catch (error) {
      setCollabError(cleanConvexError(error, 'Failed to revoke collaboration device'))
    } finally {
      setCollabAction(null)
    }
  }, [
    collabBootstrap?.status,
    collabSession,
    collabSessionResult,
    collaborationDevices,
    project,
    revokeCollabDevice,
    rotateRoomKeyWithCurrentRoom,
  ])

  const handleRotateRoomKey = useCallback(async () => {
    if (!project || !collabSession || collabBootstrap?.status !== 'ready') {
      return
    }

    setCollabAction('rotate')
    setCollabError(null)
    setCollabNotice(null)

    try {
      await rotateRoomKeyWithCurrentRoom()
      setCollabNotice('Encrypted room keys rotated. Shared-branch devices will refresh onto the new key automatically.')
    } catch (error) {
      setCollabError(cleanConvexError(error, 'Failed to rotate encrypted room keys'))
    } finally {
      setCollabAction(null)
    }
  }, [collabBootstrap?.status, collabSession, project, rotateRoomKeyWithCurrentRoom])

  const handleGenerateRecoveryKit = useCallback(async () => {
    if (
      !project ||
      !collabSession ||
      !collabBootstrap ||
      collabBootstrap.status !== 'ready' ||
      !collabBootstrap.wrappedRoomKey ||
      !collabBootstrap.senderPublicKeyJwk
    ) {
      return
    }

    setCollabAction('generate-recovery')
    setCollabError(null)
    setCollabNotice(null)

    try {
      const { roomKeyBase64 } = await window.electronAPI.collab.unwrapRoomKey({
        senderPublicKeyJwk: collabBootstrap.senderPublicKeyJwk,
        wrappedKey: collabBootstrap.wrappedRoomKey,
        wrapAlgorithm: collabBootstrap.wrapAlgorithm ?? undefined,
      })

      await buildAndStoreRecoveryKit({
        roomKeyBase64,
        keyVersion: collabBootstrap.activeKeyVersion ?? 1,
      })

      setCollabNotice(activeRecoveryKit ? 'Recovery code regenerated. Save the new code somewhere safe.' : 'Recovery code generated. Save it somewhere safe.')
    } catch (error) {
      setCollabError(cleanConvexError(error, 'Failed to generate recovery code'))
    } finally {
      setCollabAction(null)
    }
  }, [
    activeRecoveryKit,
    buildAndStoreRecoveryKit,
    collabBootstrap,
    collabSession,
    project,
  ])

  const handleRecoverWithCode = useCallback(async () => {
    if (
      !project ||
      !convexUserId ||
      !collabSession ||
      !collabBootstrap ||
      collabBootstrap.status !== 'missing_for_device' ||
      !collabSession.devicePublicKeyJwk ||
      !activeRecoveryKit ||
      !recoveryCodeInput.trim()
    ) {
      return
    }

    setCollabAction('recover')
    setCollabError(null)
    setCollabNotice(null)

    try {
      const { roomKeyBase64 } = await window.electronAPI.collab.unwrapRecoveryKit({
        recoveryCode: recoveryCodeInput.trim(),
        wrappedKey: activeRecoveryKit.wrappedKey,
        salt: activeRecoveryKit.salt,
        iterations: activeRecoveryKit.iterations,
        wrapAlgorithm: activeRecoveryKit.wrapAlgorithm,
      })

      const wrapped = await window.electronAPI.collab.wrapRoomKey({
        roomKeyBase64,
        recipientPublicKeyJwk: collabSession.devicePublicKeyJwk,
      })

      await storeWrappedRoomKey({
        projectId: project._id,
        roomId: collabSession.roomId,
        keyVersion: activeRecoveryKit.keyVersion,
        recipientUserId: convexUserId,
        recipientDeviceId: collabSession.deviceId,
        senderDeviceId: wrapped.senderDeviceId,
        senderPublicKeyJwk: wrapped.senderPublicKeyJwk,
        wrapAlgorithm: wrapped.wrapAlgorithm,
        wrappedKey: wrapped.wrappedKey,
      })

      invalidateCollabSession(String(project._id))
      await collabSessionResult.refresh()
      setRecoveryCodeInput('')
      setCollabNotice('This device recovered access to the encrypted collaboration room.')
    } catch (error) {
      setCollabError(cleanConvexError(error, 'Failed to recover room access with the recovery code'))
    } finally {
      setCollabAction(null)
    }
  }, [
    activeRecoveryKit,
    collabBootstrap,
    collabSession,
    collabSessionResult,
    convexUserId,
    project,
    recoveryCodeInput,
    storeWrappedRoomKey,
  ])

  const handleResetEncryptedRoom = useCallback(async () => {
    if (!project || !collabSession) {
      return
    }

    setCollabAction('reset')
    setCollabError(null)
    setCollabNotice(null)

    try {
      await resetEncryptedRoom({
        projectId: project._id,
        roomId: collabSession.roomId,
        userId: convexUserId ?? undefined,
        retainDeviceId: collabSession.deviceId,
      })

      if (collabScopeKey) {
        const localStore = new EncryptedLocalSnapshotStore()
        await localStore.clear(collabScopeKey)
      }

      invalidateCollabSession(String(project._id))
      await collabSessionResult.refresh()
      setCollabNotice('Encrypted collaboration room reset. Re-open the shared branch to initialize a fresh shared room from local project state.')
      setShowCollabResetDialog(false)
    } catch (error) {
      setCollabError(cleanConvexError(error, 'Failed to reset encrypted collaboration room'))
    } finally {
      setCollabAction(null)
    }
  }, [
    collabScopeKey,
    collabSession,
    collabSessionResult,
    convexUserId,
    project,
    resetEncryptedRoom,
  ])

  function closeSettingsModal(): void {
    if (isEmbedded) {
      onRequestClose?.()
      return
    }
    navigate('/projects')
  }

  if (project === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-4 w-4 animate-spin" />
        Loading project settings…
      </div>
    )
  }

  if (project === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Project not found
      </div>
    )
  }

  return (
    <>
      <div
        role={isEmbedded ? undefined : 'dialog'}
        aria-modal={isEmbedded ? undefined : true}
        className={cn(
          'relative flex h-full w-full flex-col overflow-hidden bg-background supports-[backdrop-filter]:bg-background/90 supports-[backdrop-filter]:backdrop-blur',
          !isEmbedded &&
            'max-w-4xl mx-auto my-10 rounded-[24px] border border-border/70 shadow-[0_32px_90px_rgba(15,23,42,0.28)]',
        )}
        onClick={!isEmbedded ? (e) => e.stopPropagation() : undefined}
      >
        <button
          type="button"
          onClick={closeSettingsModal}
          className="absolute right-3 top-3 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close settings"
        >
          <HugeiconsIcon icon={__XHugeIcon} className="h-3.5 w-3.5" />
        </button>

        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="w-full min-h-full px-6 pt-5 pb-6 mx-auto max-w-xl">
            <div className="w-full">
              <section className="space-y-5">
                <div className="min-w-0 space-y-6">
                  <section>
                    <h3 className="px-1 text-xs font-medium text-muted-foreground mb-1.5">
                      General
                    </h3>
                    <div className="flex flex-col overflow-hidden rounded-[14px] bg-muted">
                      <div className="flex min-h-[44px] items-center justify-between gap-4 px-4 py-2">
                        <Label htmlFor="name" className="text-xs font-medium text-foreground whitespace-nowrap">Project Name</Label>
                        <Input
                          id="name"
                          value={name}
                          onChange={(event) => {
                            setName(event.target.value)
                          }}
                          placeholder="My Project"
                          className="h-7 w-[240px] max-w-full border-none bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 text-right"
                        />
                      </div>
                      <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
                        <Label htmlFor="description" className="text-xs font-medium text-foreground whitespace-nowrap">Description</Label>
                        <Input
                          id="description"
                          value={description}
                          onChange={(event) => {
                            setDescription(event.target.value)
                          }}
                          placeholder="Short description..."
                          className="h-7 w-[240px] max-w-full border-none bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 text-right"
                        />
                      </div>
                      <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
                        <div className="flex flex-col gap-0.5 min-w-0 pr-4">
                          <Label htmlFor="slug" className="text-xs font-medium text-foreground">Project Slug</Label>
                          <p className="text-[11px] text-muted-foreground truncate">
                            Retained for compatibility links
                          </p>
                        </div>
                        <Input id="slug" value={project.slug || ''} disabled className="h-7 w-[180px] shrink-0 border-none bg-transparent px-0 text-sm shadow-none opacity-50 cursor-not-allowed text-right" />
                      </div>
                      {saveError ? (
                        <div className="border-t border-border/40 px-4 py-3">
                          <p className="text-xs text-destructive">{saveError}</p>
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
                <div className="min-w-0 space-y-6">
                  <section>
                    <h3 className="px-1 text-xs font-medium text-muted-foreground mb-1.5">
                      Collaboration Security
                    </h3>
                    <div className="flex flex-col overflow-hidden rounded-[14px] bg-muted">
                      <div className="border-b border-border/40 px-4 py-3">
                        <p className="text-xs font-medium text-foreground">Encrypted shared collaboration</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Shared-branch collaboration is encrypted end to end. Git remains fully manual.
                        </p>
                      </div>
                      <div className="px-4 py-3 text-[11px] text-muted-foreground">
                        {collabSessionResult.status === 'loading' ? 'Checking collaboration room security…' : null}
                        {collabSessionResult.status === 'error' ? (
                          <span className="text-destructive">{collabSessionResult.error ?? 'Failed to load collaboration security status.'}</span>
                        ) : null}
                        {collabBootstrap?.status === 'room_not_initialized' ? (
                          <span>
                            Encrypted collaboration will initialize automatically the next time someone opens the shared branch.
                          </span>
                        ) : null}
                        {collabBootstrap?.status === 'missing_for_device' ? (
                          <span>
                            {activeRecoveryKit
                              ? 'This device is waiting for an already-authorized device or a saved recovery code to restore room access.'
                              : 'This device is waiting for an already-authorized device to share the room key.'}
                          </span>
                        ) : null}
                        {collabBootstrap?.status === 'device_revoked' ? (
                          <span className="text-destructive">
                            This device has been revoked from encrypted collaboration. Switch to the shared branch from another authorized device to approve a new one.
                          </span>
                        ) : null}
                        {collabBootstrap?.status === 'ready' ? (
                          <span>
                            This device is authorized for encrypted collaboration. {pendingRequestCount > 0 ? `${pendingRequestCount} device${pendingRequestCount === 1 ? '' : 's'} waiting for approval.` : 'No devices are waiting for approval right now.'}
                          </span>
                        ) : null}
                      </div>
                      {collabError ? (
                        <div className="border-t border-border/40 px-4 py-3">
                          <p className="text-xs text-destructive">{collabError}</p>
                        </div>
                      ) : null}
                      {collabNotice ? (
                        <div className="border-t border-border/40 px-4 py-3">
                          <p className="text-xs text-emerald-600">{collabNotice}</p>
                        </div>
                      ) : null}
                      {collabBootstrap?.status === 'ready' && canManageCollabSecurity ? (
                        <div className="flex items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
                          <div className="flex flex-col gap-0.5">
                            <Label className="text-xs font-medium text-foreground">Trusted-device recovery</Label>
                            <p className="text-[11px] text-muted-foreground">
                              Approve waiting devices from a device that already has the shared room key.
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={pendingRequestCount === 0 || collabAction === 'share'}
                            onClick={() => {
                              void handleSharePendingDevices()
                            }}
                          >
                            {collabAction === 'share' ? (
                              <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Share keys
                          </Button>
                        </div>
                      ) : null}
                      {collabBootstrap?.status === 'ready' && canManageCollabSecurity ? (
                        <div className="flex items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
                          <div className="flex flex-col gap-0.5">
                            <Label className="text-xs font-medium text-foreground">Recovery code</Label>
                            <p className="text-[11px] text-muted-foreground">
                              Save an offline recovery code so a new device can restore shared-room access without another trusted device.
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={collabAction === 'generate-recovery'}
                            onClick={() => {
                              void handleGenerateRecoveryKit()
                            }}
                          >
                            {collabAction === 'generate-recovery' ? (
                              <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            {activeRecoveryKit ? 'Regenerate code' : 'Generate code'}
                          </Button>
                        </div>
                      ) : null}
                      {collabBootstrap?.status === 'ready' && canManageCollabSecurity ? (
                        <div className="flex items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
                          <div className="flex flex-col gap-0.5">
                            <Label className="text-xs font-medium text-foreground">Rotate room key</Label>
                            <p className="text-[11px] text-muted-foreground">
                              Re-wrap the shared room for currently trusted devices and retire the previous room key.
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={collabAction === 'rotate' || !collaborationDevices || collaborationDevices.length === 0}
                            onClick={() => {
                              void handleRotateRoomKey()
                            }}
                          >
                            {collabAction === 'rotate' ? (
                              <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Rotate keys
                          </Button>
                        </div>
                      ) : null}
                      {canManageCollabSecurity && collabBootstrap?.status !== 'room_not_initialized' ? (
                        <div className="flex items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
                          <div className="flex flex-col gap-0.5">
                            <Label className="text-xs font-medium text-foreground">Room recovery</Label>
                            <p className="text-[11px] text-muted-foreground">
                              If no currently-authorized device can approve this room, reset the encrypted shared room and start fresh.
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                            disabled={collabAction === 'reset'}
                            onClick={() => {
                              setShowCollabResetDialog(true)
                            }}
                          >
                            Reset room
                          </Button>
                        </div>
                      ) : null}
                      {collabBootstrap?.status === 'missing_for_device' && activeRecoveryKit && collabSession?.devicePublicKeyJwk ? (
                        <div className="flex flex-col gap-3 border-t border-border/40 px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <Label className="text-xs font-medium text-foreground">Recover with code</Label>
                            <p className="text-[11px] text-muted-foreground">
                              Enter a saved recovery code to authorize this device without another trusted device.
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              value={recoveryCodeInput}
                              onChange={(event) => {
                                setRecoveryCodeInput(event.target.value)
                              }}
                              placeholder="XXXX-XXXX-XXXX-XXXX"
                              className="h-8 text-xs"
                            />
                            <Button
                              variant="outline"
                              className="h-8 text-[11px]"
                              disabled={collabAction === 'recover' || recoveryCodeInput.trim().length === 0}
                              onClick={() => {
                                void handleRecoverWithCode()
                              }}
                            >
                              {collabAction === 'recover' ? (
                                <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-3.5 w-3.5 animate-spin" />
                              ) : null}
                              Recover
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      {collaborationDevices && collaborationDevices.length > 0 ? (
                        <div className="border-t border-border/40">
                          {collaborationDevices.map((device, index) => (
                            <div
                              key={device.deviceId}
                              className={cn(
                                'flex min-h-[44px] items-center justify-between gap-4 px-4 py-2',
                                index > 0 && 'border-t border-border/40',
                              )}
                            >
                              <div className="flex min-w-0 flex-col gap-0.5">
                                <p className="truncate text-xs font-medium text-foreground">
                                  {device.deviceLabel}
                                  {device.deviceId === currentDeviceId ? ' · This device' : ''}
                                </p>
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {device.platform} · {device.fingerprint.slice(0, 12)}
                                  {device.hasPendingRequest ? ' · waiting for key' : ''}
                                  {device.revokedAt ? ' · revoked' : ''}
                                </p>
                              </div>
                              {canManageCollabSecurity ? (
                                <Button
                                  variant="ghost"
                                  className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                                  disabled={
                                    Boolean(device.revokedAt) ||
                                    device.deviceId === currentDeviceId ||
                                    collabAction === `revoke:${device.deviceId}`
                                  }
                                  onClick={() => {
                                    void handleRevokeDevice(device.deviceId)
                                  }}
                                >
                                  {collabAction === `revoke:${device.deviceId}` ? (
                                    <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-3.5 w-3.5 animate-spin" />
                                  ) : null}
                                  {device.revokedAt ? 'Revoked' : 'Revoke'}
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>

                <div className="min-w-0 space-y-6">
                  <section>
                    <h3 className="flex items-center gap-1.5 px-1 text-xs font-medium text-destructive mb-1.5">
                      <HugeiconsIcon icon={__AlertTriangleHugeIcon} className="h-3.5 w-3.5" />
                      Danger Zone
                    </h3>
                    <div className="flex flex-col overflow-hidden rounded-[14px] bg-destructive/15 dark:bg-destructive/20">
                      <div className="flex min-h-[44px] items-center justify-between gap-4 px-4 py-2">
                        <div className="flex flex-col gap-0.5">
                          <Label className="text-xs font-medium text-foreground">Archive Project</Label>
                          <p className="text-[11px] text-muted-foreground">
                            Archive this project. It can be restored later.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          className="h-7 text-[11px] text-orange-500 hover:text-orange-600 bg-background/50 border-destructive/20"
                          disabled={!convexUserId || !isManager || project.status === 'archived'}
                          onClick={() => {
                            setShowArchiveDialog(true)
                            setArchiveError(null)
                          }}
                        >
                          {project.status === 'archived' ? 'Archived' : 'Archive Project'}
                        </Button>
                      </div>
                      <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-destructive/20 px-4 py-2">
                        <div className="flex flex-col gap-0.5">
                          <Label className="text-xs font-medium text-foreground">Delete Project</Label>
                          <p className="text-[11px] text-muted-foreground">
                            Permanently delete this project and all its data. This action cannot be undone.
                          </p>
                        </div>
                        <Button
                          variant="destructive"
                          disabled={!convexUserId}
                          className="h-7 text-[11px]"
                          onClick={() => {
                            setShowDeleteDialog(true)
                            setDeleteError(null)
                          }}
                        >
                          <HugeiconsIcon icon={__Trash2HugeIcon} className="mr-2 h-4 w-4" />
                          Delete Project
                        </Button>
                      </div>
                    </div>
                  </section>
                </div>

                <div className="flex justify-end pt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
                    onClick={() => {
                      void handleSave()
                    }}
                    disabled={!canSave}
                  >
                    {isSaving ? (
                      <HugeiconsIcon icon={__Loader2HugeIcon} className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <HugeiconsIcon icon={__SaveHugeIcon} className="h-3.5 w-3.5" />
                    )}
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </section>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>

      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Project</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive <span className="font-semibold">{project.name}</span>. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveError ? <p className="text-sm text-destructive">{archiveError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleArchive()
              }}
              disabled={isArchiving}
              className="bg-orange-500 text-white hover:bg-orange-600"
            >
              {isArchiving ? 'Archiving...' : 'Archive Project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProjectDeleteDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open)
          if (!open) {
            setDeleteError(null)
          }
        }}
        projectName={project.name}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        errorMessage={deleteError}
      />

      <AlertDialog open={showCollabResetDialog} onOpenChange={setShowCollabResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset encrypted collaboration room</AlertDialogTitle>
            <AlertDialogDescription>
              This clears the current encrypted shared collaboration state for <span className="font-semibold">{project.name}</span>.
              Use this only when no currently-authorized device can approve access or recover the room.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            Local files on this device stay intact, but the shared encrypted room history and keys will be replaced.
          </p>
          {collabError ? <p className="text-sm text-destructive">{collabError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={collabAction === 'reset'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleResetEncryptedRoom()
              }}
              disabled={collabAction === 'reset'}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {collabAction === 'reset' ? 'Resetting…' : 'Reset room'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showRecoveryCodeDialog}
        onOpenChange={(open) => {
          setShowRecoveryCodeDialog(open)
          if (!open) {
            setGeneratedRecoveryCode(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save this recovery code</AlertDialogTitle>
            <AlertDialogDescription>
              This code can restore encrypted collaboration access for a new device when no trusted device is available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl bg-muted px-4 py-3">
            <p className="font-mono text-sm tracking-[0.18em] text-foreground">
              {generatedRecoveryCode ?? 'No recovery code generated.'}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Keep it somewhere safe. We only show the newly generated code here.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (generatedRecoveryCode) {
                  void navigator.clipboard.writeText(generatedRecoveryCode)
                }
              }}
            >
              Copy code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
