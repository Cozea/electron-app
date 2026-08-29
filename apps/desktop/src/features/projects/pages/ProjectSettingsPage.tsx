import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import * as Y from 'yjs'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useCollabSession, invalidateCollabSession } from '@/hooks/useCollabSession'
import { useTranslation } from '@/lib/i18n'
import { featureFlags } from '@/lib/featureFlags'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { ProjectDeleteDialog } from '@/features/projects/components/ProjectDeleteDialog'
import { cleanupDeletedProjectLocally } from '@/features/projects/lib/projectLocalCleanup'
import { detachDeletedProjectFromUi } from '@/features/projects/lib/detachDeletedProjectFromUi'
import type { ProjectDeleteConfirmOptions } from '@/features/projects/components/ProjectDeleteDialog'
import { formatProjectDeleteError } from '@/features/projects/lib/projectMutationPresentation'
import { withProjectMutationTimeout } from '@/features/projects/lib/projectMutationTimeout'
import { DevAppIcon } from '@/features/devapps/components/DevAppIcon'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  SettingsGroup,
  SettingsDangerGroup,
  SettingsRow,
  SettingsRowLabel,
  SettingsRowControl,
  SettingsSectionTitle,
  SettingsPageHeader,
  settingsInlineInputClass,
  settingsInlineInputWidth,
} from '@/components/settings/SettingsChrome'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Alert01Icon as __AlertTriangleHugeIcon, Bookmark01Icon as __SaveHugeIcon, Cancel01Icon as __XHugeIcon, Delete02Icon as __Trash2HugeIcon, Edit01Icon as __EditHugeIcon, MoreHorizontalIcon as __MoreHorizontalHugeIcon } from '@hugeicons/core-free-icons'

const LazyProjectDevAppLogoDialog = lazy(() =>
  import('@/features/devapps/components/ProjectDevAppLogoDialog').then((module) => ({
    default: module.ProjectDevAppLogoDialog,
  })),
)

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
  const orgDevApp = useQuery(
    api.devApps.getForProject,
    featureFlags.projectDevApps && project?._id && convexUserId
      ? { projectId: project._id }
      : 'skip',
  )
  const updateDevAppIdentity = useMutation(api.devApps.updateIdentity)
  const { t } = useTranslation()

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
  const isManager = memberRole === 'project_manager'
  const collabSessionResult = useCollabSession({
    projectId: project?._id ? String(project._id) : null,
    enabled: Boolean(project?._id),
  })
  const collaborationDevices = useQuery(
    api.yjs.listCollabRoomDevices,
    isManager && project?._id && collabSessionResult.session?.roomId
      ? { projectId: project._id, roomId: collabSessionResult.session.roomId }
      : 'skip',
  )
  const pendingKeyRequests = useQuery(
    api.yjs.listPendingKeyRequests,
    isManager && project?._id && collabSessionResult.session?.roomId
      ? { projectId: project._id, roomId: collabSessionResult.session.roomId }
      : 'skip',
  )
  const activeRecoveryKit = useQuery(
    unsafeYjsApi.yjs.getActiveRecoveryKit,
    isManager && project?._id && collabSessionResult.session?.roomId
      ? { projectId: project._id, roomId: collabSessionResult.session.roomId }
      : 'skip',
  ) as ActiveRecoveryKit | null | undefined

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showDevAppIdentityDialog, setShowDevAppIdentityDialog] = useState(false)
  const [devAppIdentityError, setDevAppIdentityError] = useState<string | null>(null)

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
    setShowDevAppIdentityDialog(false)
    setDevAppIdentityError(null)
  }, [
    project?._id,
    project?.description,
    project?.name,
    project,
  ])

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
  const canManageCollabSecurity = Boolean(project?._id && convexUserId && isManager)
  const pendingRequestCount = pendingKeyRequests?.filter((request) => typeof request.fulfilledAt !== 'number').length ?? 0
  const collabRotationRequired = collaborationDevices?.some((device) => device.rotationRequired) ?? false

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
      throw new Error(t('settings.error.noTrustedDevices'))
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
      throw new Error(t('settings.error.noTrustedDevices'))
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
      setSaveError(t('settings.error.nameRequired'))
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
      setSaveError(cleanConvexError(error, t('settings.error.saveFailed')))
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
      setArchiveError(cleanConvexError(error, t('settings.error.archiveFailed')))
    } finally {
      setIsArchiving(false)
    }
  }, [archiveProject, convexUserId, navigate, project])

  const handleDelete = useCallback(async ({ keepLocalFiles }: ProjectDeleteConfirmOptions) => {
    if (!project || !convexUserId) return

    setIsDeleting(true)
    setDeleteError(null)
    const deletedProjectId = String(project._id)
    try {
      await withProjectMutationTimeout(
        removeProject({
          projectId: project._id,
          userId: convexUserId,
          // Server still validates the name; UI no longer requires retyping it.
          confirmName: project.name,
        }),
        'Deleting this project is taking longer than expected. Check your connection and try again.',
      )

      detachDeletedProjectFromUi(deletedProjectId)
      setShowDeleteDialog(false)
      navigate('/projects', { replace: true })

      await cleanupDeletedProjectLocally(deletedProjectId, {
        keepLocalFiles,
        projectSlug: project.slug,
      })
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

      setCollabNotice(t('settings.notice.shared'))
      await collabSessionResult.refresh()
    } catch (error) {
      setCollabError(cleanConvexError(error, t('settings.error.shareFailed')))
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
        setCollabNotice(t('settings.notice.revokedAndRotated'))
      } else {
        setCollabNotice(t('settings.notice.revokedFuture'))
      }
      await collabSessionResult.refresh()
    } catch (error) {
      setCollabError(cleanConvexError(error, t('settings.error.revokeFailed')))
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
      setCollabNotice(t('settings.notice.rotated'))
    } catch (error) {
      setCollabError(cleanConvexError(error, t('settings.error.rotateFailed')))
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

      setCollabNotice(activeRecoveryKit ? t('settings.notice.recoveryRegenerated') : t('settings.notice.recoveryGenerated'))
    } catch (error) {
      setCollabError(cleanConvexError(error, t('settings.error.generateRecoveryFailed')))
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
      setCollabNotice(t('settings.notice.recovered'))
    } catch (error) {
      setCollabError(cleanConvexError(error, t('settings.error.recoverFailed')))
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
      setCollabNotice(t('settings.notice.reset'))
      setShowCollabResetDialog(false)
    } catch (error) {
      setCollabError(cleanConvexError(error, t('settings.error.resetFailed')))
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
        <div className="loader mr-2" />
        {t('settings.loading')}
      </div>
    )
  }

  if (project === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('settings.error.projectNotFound')}
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
            'max-w-5xl mx-auto my-8 rounded-[24px] border border-border/70 shadow-[0_32px_90px_rgba(15,23,42,0.28)]',
        )}
        onClick={!isEmbedded ? (e) => e.stopPropagation() : undefined}
      >
        <button
          type="button"
          onClick={closeSettingsModal}
          className="absolute right-3 top-3 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground/70 transition-colors hover:bg-muted/80 hover:text-foreground"
          aria-label={t('settings.action.close')}
        >
          <HugeiconsIcon icon={__XHugeIcon} className="h-3.5 w-3.5" />
        </button>

        <div className="flex-1 min-h-0">
          <ScrollArea className="scroll-fade-y h-full">
            <div className="w-full min-h-full px-8 sm:px-10 pt-6 pb-12 mx-auto max-w-4xl">
              <SettingsPageHeader
                title={project.name}
                description={project.description || undefined}
              />
              <div className="w-full space-y-6">
                <section>
                  <SettingsSectionTitle>{t('settings.section.general')}</SettingsSectionTitle>
                  <SettingsGroup>
                    <SettingsRow isFirst>
                      <SettingsRowLabel title={t('settings.label.projectName')} htmlFor="name" />
                      <SettingsRowControl>
                        <Input
                          id="name"
                          value={name}
                          onChange={(event) => {
                            setName(event.target.value)
                          }}
                          placeholder={t('settings.placeholder.projectName')}
                          className={cn(settingsInlineInputClass, settingsInlineInputWidth)}
                        />
                      </SettingsRowControl>
                    </SettingsRow>
                    <SettingsRow>
                      <SettingsRowLabel title={t('settings.label.description')} htmlFor="description" />
                      <SettingsRowControl>
                        <Input
                          id="description"
                          value={description}
                          onChange={(event) => {
                            setDescription(event.target.value)
                          }}
                          placeholder={t('settings.placeholder.description')}
                          className={cn(settingsInlineInputClass, settingsInlineInputWidth)}
                        />
                      </SettingsRowControl>
                    </SettingsRow>
                    <SettingsRow>
                      <SettingsRowLabel
                        title={t('settings.label.slug')}
                        description={t('settings.desc.slug')}
                        htmlFor="slug"
                      />
                      <SettingsRowControl>
                        <Input id="slug" value={project.slug || ''} disabled className="h-7 w-[180px] shrink-0 border-0 border-none bg-transparent px-0 text-xs font-normal text-foreground shadow-none opacity-50 cursor-not-allowed text-right dark:border-none dark:bg-transparent" />
                      </SettingsRowControl>
                    </SettingsRow>
                    {saveError ? (
                      <div className="border-t border-border/40 px-4 py-3">
                        <p className="text-xs text-destructive">{saveError}</p>
                      </div>
                    ) : null}
                  </SettingsGroup>
                </section>
                {orgDevApp?.hasArtifact ? (
                  <section>
                    <SettingsSectionTitle>{t('settings.section.localDevApp')}</SettingsSectionTitle>
                    <SettingsGroup>
                      <div className="flex min-h-[64px] items-center gap-3 px-4 py-3">
                        <button
                          type="button"
                          aria-label={t('appStore.page.editDevAppFor').replace(
                            '{name}',
                            orgDevApp.name,
                          )}
                          className="group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-500/18 via-violet-500/8 to-transparent outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted"
                          style={{ borderRadius: 40 * 0.22265625 }}
                          onClick={() => {
                            setDevAppIdentityError(null)
                            setShowDevAppIdentityDialog(true)
                          }}
                        >
                          <DevAppIcon
                            app={{
                              name: orgDevApp.name,
                              icon: orgDevApp.logoDataUrl
                                ? { src: orgDevApp.logoDataUrl, alt: `${orgDevApp.name} DevApp` }
                                : { src: '', alt: `${orgDevApp.name} DevApp` },
                            }}
                          />
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                            <HugeiconsIcon icon={__EditHugeIcon} className="size-3.5" />
                          </span>
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate text-xs font-medium text-foreground">
                              {orgDevApp.name}
                            </p>
                            {orgDevApp.version != null ? (
                              <span className="shrink-0 rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                                V{orgDevApp.version}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {t('settings.desc.localDevAppIdentity')}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 shrink-0 bg-background/50 text-[11px]"
                          onClick={() => {
                            setDevAppIdentityError(null)
                            setShowDevAppIdentityDialog(true)
                          }}
                        >
                          <HugeiconsIcon icon={__EditHugeIcon} className="mr-1.5 h-3.5 w-3.5" />
                          {t('settings.action.editDevApp')}
                        </Button>
                      </div>
                    </SettingsGroup>
                  </section>
                ) : null}

                <section>
                  <SettingsSectionTitle>{t('settings.section.collabSecurity')}</SettingsSectionTitle>
                  <SettingsGroup>
                    <div className="px-4 py-3">
                      <p className="text-xs font-medium text-foreground">{t('settings.label.collabTitle')}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {t('settings.desc.collabTitle')}
                      </p>
                    </div>
                    <div className="px-4 py-3 text-[11px] text-muted-foreground">
                      {collabSessionResult.status === 'loading' ? t('settings.collab.loading') : null}
                      {collabSessionResult.status === 'error' ? (
                        <span className="text-destructive">{collabSessionResult.error ?? t('settings.collab.error')}</span>
                      ) : null}
                      {collabBootstrap?.status === 'room_not_initialized' ? (
                        <span>
                          {t('settings.collab.notInitialized')}
                        </span>
                      ) : null}
                      {collabBootstrap?.status === 'missing_for_device' ? (
                        <span>
                          {activeRecoveryKit
                            ? t('settings.collab.missingForDeviceRecover')
                            : t('settings.collab.missingForDevice')}
                        </span>
                      ) : null}
                      {collabBootstrap?.status === 'device_revoked' ? (
                        <span className="text-destructive">
                          {t('settings.collab.deviceRevoked')}
                        </span>
                      ) : null}
                      {collabBootstrap?.status === 'ready' ? (
                        <span>
                          {collabRotationRequired
                            ? 'A device was revoked. Rotate the room key before continuing collaboration.'
                            : pendingRequestCount > 0
                              ? t('settings.collab.readyDevices').replace('{count}', String(pendingRequestCount))
                              : t('settings.collab.readyNoDevices')}
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
                        <p className="text-xs text-emerald-600 dark:text-emerald-500">{collabNotice}</p>
                      </div>
                    ) : null}
                    {collabBootstrap?.status === 'ready' && canManageCollabSecurity ? (
                      <SettingsRow>
                        <SettingsRowLabel
                          title={t('settings.collab.trustedDeviceRecovery')}
                          description={t('settings.collab.trustedDeviceRecoveryDesc')}
                        />
                        <SettingsRowControl>
                          <Button
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={pendingRequestCount === 0 || collabAction === 'share'}
                            onClick={() => {
                              void handleSharePendingDevices()
                            }}
                          >
                            {collabAction === 'share' ? (
                              <div className="loader mr-2" />
                            ) : null}
                            {t('settings.collab.shareKeys')}
                          </Button>
                        </SettingsRowControl>
                      </SettingsRow>
                    ) : null}
                    {collabBootstrap?.status === 'ready' && canManageCollabSecurity ? (
                      <SettingsRow>
                        <SettingsRowLabel
                          title={t('settings.collab.recoveryCode')}
                          description={t('settings.collab.recoveryCodeDesc')}
                        />
                        <SettingsRowControl>
                          <Button
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={collabAction === 'generate-recovery'}
                            onClick={() => {
                              void handleGenerateRecoveryKit()
                            }}
                          >
                            {collabAction === 'generate-recovery' ? (
                              <div className="loader mr-2" />
                            ) : null}
                            {activeRecoveryKit ? t('settings.collab.regenerateCode') : t('settings.collab.generateCode')}
                          </Button>
                        </SettingsRowControl>
                      </SettingsRow>
                    ) : null}
                    {collabBootstrap?.status === 'ready' && canManageCollabSecurity ? (
                      <SettingsRow>
                        <SettingsRowLabel
                          title={t('settings.collab.rotateRoomKey')}
                          description={t('settings.collab.rotateRoomKeyDesc')}
                        />
                        <SettingsRowControl>
                          <Button
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={collabAction === 'rotate' || !collaborationDevices || collaborationDevices.length === 0}
                            onClick={() => {
                              void handleRotateRoomKey()
                            }}
                          >
                            {collabAction === 'rotate' ? (
                              <div className="loader mr-2" />
                            ) : null}
                            {t('settings.collab.rotateKeys')}
                          </Button>
                        </SettingsRowControl>
                      </SettingsRow>
                    ) : null}
                    {canManageCollabSecurity && collabBootstrap?.status !== 'room_not_initialized' ? (
                      <SettingsRow>
                        <SettingsRowLabel
                          title={t('settings.collab.roomRecovery')}
                          description={t('settings.collab.roomRecoveryDesc')}
                        />
                        <SettingsRowControl>
                          <Button
                            variant="ghost"
                            className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                            disabled={collabAction === 'reset'}
                            onClick={() => {
                              setShowCollabResetDialog(true)
                            }}
                          >
                            {t('settings.collab.resetRoom')}
                          </Button>
                        </SettingsRowControl>
                      </SettingsRow>
                    ) : null}
                    {collabBootstrap?.status === 'missing_for_device' && activeRecoveryKit && collabSession?.devicePublicKeyJwk ? (
                      <div className="flex flex-col gap-3 border-t border-border/40 px-4 py-3">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <Label className="text-xs font-medium text-foreground">{t('settings.collab.recoverWithCode')}</Label>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {t('settings.collab.recoverWithCodeDesc')}
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
                              <div className="loader mr-2" />
                            ) : null}
                            {t('settings.collab.recover')}
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
                              'flex min-h-[50px] items-center justify-between gap-4 px-4 py-3',
                              index > 0 && 'border-t border-border/40',
                            )}
                          >
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <p className="truncate text-xs font-medium text-foreground">
                                {device.deviceLabel}
                                {device.deviceId === currentDeviceId ? ` · ${t('settings.collab.thisDevice')}` : ''}
                              </p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {device.platform} · {device.fingerprint.slice(0, 12)}
                                {device.hasPendingRequest ? ` · ${t('settings.collab.waitingForKey')}` : ''}
                                {device.revokedAt ? ` · ${t('settings.collab.revoked')}` : ''}
                              </p>
                            </div>
                            {canManageCollabSecurity ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-7 rounded-lg p-0 text-muted-foreground hover:text-foreground"
                                    disabled={
                                      Boolean(device.revokedAt) ||
                                      device.deviceId === currentDeviceId ||
                                      collabAction === `revoke:${device.deviceId}`
                                    }
                                  >
                                    <HugeiconsIcon icon={__MoreHorizontalHugeIcon} className="size-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => {
                                      void handleRevokeDevice(device.deviceId)
                                    }}
                                  >
                                    {device.revokedAt ? t('settings.collab.actionRevoked') : t('settings.collab.revoke')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </SettingsGroup>
                </section>

                <section>
                  <SettingsSectionTitle variant="danger">
                    <HugeiconsIcon icon={__AlertTriangleHugeIcon} className="h-3.5 w-3.5" />
                    {t('settings.section.dangerZone')}
                  </SettingsSectionTitle>
                  <SettingsDangerGroup>
                    <SettingsRow isFirst>
                      <SettingsRowLabel
                        title={t('settings.label.archiveProject')}
                        description={t('settings.desc.archiveProject')}
                      />
                      <SettingsRowControl>
                        <Button
                          variant="outline"
                          className="h-7 text-[11px] text-orange-500 hover:text-orange-600 bg-background/50 border-destructive/20"
                          disabled={!convexUserId || !isManager || project.status === 'archived'}
                          onClick={() => {
                            setShowArchiveDialog(true)
                            setArchiveError(null)
                          }}
                        >
                          {project.status === 'archived' ? t('settings.action.archived') : t('settings.action.archive')}
                        </Button>
                      </SettingsRowControl>
                    </SettingsRow>
                    <SettingsRow>
                      <SettingsRowLabel
                        title={t('settings.label.deleteProject')}
                        description={t('settings.desc.deleteProject')}
                      />
                      <SettingsRowControl>
                        <Button
                          variant="destructive"
                          disabled={!convexUserId}
                          className="h-7 text-[11px]"
                          onClick={() => {
                            setShowDeleteDialog(true)
                            setDeleteError(null)
                          }}
                        >
                          <HugeiconsIcon icon={__Trash2HugeIcon} className="mr-1.5 h-4 w-4" />
                          {t('settings.action.delete')}
                        </Button>
                      </SettingsRowControl>
                    </SettingsRow>
                  </SettingsDangerGroup>
                </section>

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
                      <div className="loader" />
                    ) : (
                      <HugeiconsIcon icon={__SaveHugeIcon} className="h-3.5 w-3.5" />
                    )}
                    {isSaving ? t('settings.action.saving') : t('settings.action.save')}
                  </Button>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>

      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.dialog.archive.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.dialog.archive.desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveError ? <p className="text-sm text-destructive">{archiveError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>{t('settings.action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleArchive()
              }}
              disabled={isArchiving}
              className="bg-orange-500 text-white hover:bg-orange-600"
            >
              {isArchiving ? t('settings.dialog.archive.archiving') : t('settings.dialog.archive.action')}
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
        projectId={String(project._id)}
        projectName={project.name}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        errorMessage={deleteError}
      />

      {orgDevApp && showDevAppIdentityDialog ? (
        <Suspense fallback={null}>
          <LazyProjectDevAppLogoDialog
            open
            projectName={orgDevApp.name}
            mode="change"
            initialName={orgDevApp.name}
            initialLogoDataUrl={orgDevApp.logoDataUrl ?? undefined}
            saveErrorMessage={devAppIdentityError}
            onOpenChange={(open) => {
              setShowDevAppIdentityDialog(open)
              if (!open) {
                setDevAppIdentityError(null)
              }
            }}
            onConfirm={(logoDataUrl, devAppName) => {
              void (async () => {
                if (!convexUserId) return
                try {
                  await updateDevAppIdentity({
                    publicationId: orgDevApp.publicationId,
                    name: devAppName,
                    logoDataUrl,
                  })
                  setShowDevAppIdentityDialog(false)
                  setDevAppIdentityError(null)
                } catch (error) {
                  setDevAppIdentityError(
                    error instanceof Error
                      ? error.message
                      : t('projectDevApp.logo.error'),
                  )
                }
              })()
            }}
          />
        </Suspense>
      ) : null}

      <AlertDialog open={showCollabResetDialog} onOpenChange={setShowCollabResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.dialog.reset.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.dialog.reset.desc1')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('settings.dialog.reset.desc2')}
          </p>
          {collabError ? <p className="text-sm text-destructive">{collabError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={collabAction === 'reset'}>{t('settings.action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleResetEncryptedRoom()
              }}
              disabled={collabAction === 'reset'}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {collabAction === 'reset' ? t('settings.dialog.reset.resetting') : t('settings.dialog.reset.action')}
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
            <AlertDialogTitle>{t('settings.dialog.recovery.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.dialog.recovery.desc1')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl bg-muted px-4 py-3">
            <p className="font-mono text-sm tracking-[0.18em] text-foreground">
              {generatedRecoveryCode ?? t('settings.dialog.recovery.noCode')}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('settings.dialog.recovery.desc2')}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.action.close')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (generatedRecoveryCode) {
                  void navigator.clipboard.writeText(generatedRecoveryCode)
                }
              }}
            >
              {t('settings.action.copyCode')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
