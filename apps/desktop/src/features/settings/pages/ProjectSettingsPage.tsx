import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { cleanConvexError } from "@/lib/convexError"
import { useNavigateTo, useViewTransitionNavigate } from '@/lib/navigation'
import { useSearchParams } from '@/lib/router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useProjectTeam } from '@/hooks/useProjectTeam'
import { useMyOrganizations } from '@/hooks/useMyOrganizations'
import { SessionRecoveryPanel } from '@/features/settings/ui/SessionRecoveryPanel'
import { useTranslation } from '@/lib/i18n'
import { featureFlags } from '@/lib/featureFlags'
import { useAccessibleProject } from '@/contexts/project/useAccessibleProject'
import { confirmProjectDeletion, type ProjectDeleteConfirmOptions } from '@/features/projects/ui/ProjectDeleteDialog'
import { cleanupDeletedProjectLocally } from '@/features/projects/lib/projectLocalCleanup'
import { detachDeletedProjectFromUi } from '@/features/projects/lib/detachDeletedProjectFromUi'
import { formatProjectDeleteError } from '@/features/projects/lib/projectMutationPresentation'
import { withProjectMutationTimeout } from '@/features/projects/lib/projectMutationTimeout'
import { PublishedDevAppIcon } from '@/features/devapps/components/PublishedDevAppIcon'
import { OrgAttachDialog } from '@/features/projects/ui/OrgAttachDialog'
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
} from '@/features/settings/ui/SettingsChrome'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert01Icon as __AlertTriangleHugeIcon,
  Bookmark01Icon as __SaveHugeIcon,
  Delete02Icon as __Trash2HugeIcon,
  Edit01Icon as __EditHugeIcon,
} from '@hugeicons/core-free-icons'

const LazyProjectDevAppLogoDialog = lazy(() =>
  import('@/features/devapps/components/ProjectDevAppLogoDialog').then((module) => ({
    default: module.ProjectDevAppLogoDialog,
  })),
)

/** The project's settings page, at /projects/p/:projectId/settings. */

export function ProjectSettingsPage() {
  const navigate = useViewTransitionNavigate()
  const navigateTo = useNavigateTo()
  const [searchParams] = useSearchParams()
  const requestedSection = searchParams.get('section') === 'danger' ? 'danger' : 'general'
  const { principalId } = useAuth()
  const { project } = useAccessibleProject()
  const orgDevApp = useQuery(
    api.devApps.getForProject,
    featureFlags.projectDevApps && project?._id && principalId
      ? { projectId: project._id }
      : 'skip',
  )
  const updateDevAppIdentity = useMutation(api.devApps.updateIdentity)
  const { t } = useTranslation()

  const updateProject = useMutation(api.projects.update)
  const archiveProject = useMutation(api.projects.archive)
  const removeProject = useMutation(api.projects.deleteProject)
  const attachProjectToOrg = useMutation(api.organizations.attachProject)
  const createAndAttachProjectOrg = useMutation(api.organizations.createAndAttachProject)
  const myOrgs = useMyOrganizations()
  const projectOrg = myOrgs?.find((org) => String(org.organizationId) === String(project?.organizationId)) ?? null

  const { memberRole } = useProjectTeam(project?._id)
  const isManager = memberRole === 'project_manager'

  const [name, setName] = useState(() => project?.name ?? '')
  const [description, setDescription] = useState(() => project?.description ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showDevAppIdentityDialog, setShowDevAppIdentityDialog] = useState(false)
  const [devAppIdentityError, setDevAppIdentityError] = useState<string | null>(null)

  const [isArchiving, setIsArchiving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showOrgAttach, setShowOrgAttach] = useState(false)
  const [orgError, setOrgError] = useState<string | null>(null)

  useEffect(() => {
    if (!project) return
    setName((current) => (current && current !== project.name ? current : project.name ?? ''))
    setDescription((current) => (current && current !== project.description ? current : project.description ?? ''))
    setSaveError(null)
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
  const canSave = Boolean(principalId) && canEditGeneral && !isSaving && hasChanges && name.trim().length > 0

  const handleSave = useCallback(async () => {
    if (!project || !principalId) return

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
        principalId: principalId,
        name: nextName,
        description,
      })
    } catch (error) {
      setSaveError(cleanConvexError(error, t('settings.error.saveFailed')))
    } finally {
      setIsSaving(false)
    }
  }, [
    principalId,
    description,
    hasChanges,
    name,
    project,
    t,
    updateProject,
  ])

  const handleArchive = useCallback(async () => {
    if (!project || !principalId) return

    setIsArchiving(true)
    try {
      await archiveProject({
        projectId: project._id,
        principalId: principalId,
      })
      navigateTo({ to: "projects" })
    } catch (error) {
      const message = cleanConvexError(error, t('settings.error.archiveFailed'))
      await window.electronAPI.dialog.showMessageBox({
        type: 'error',
        title: t('settings.error.archiveFailed'),
        message: t('settings.error.archiveFailed'),
        detail: message,
      })
    } finally {
      setIsArchiving(false)
    }
  }, [archiveProject, principalId, navigate, project, t])

  const handleDelete = useCallback(async ({ keepLocalFiles }: ProjectDeleteConfirmOptions) => {
    if (!project || !principalId) return

    setIsDeleting(true)
    const deletedProjectId = String(project._id)
    try {
      await withProjectMutationTimeout(
        removeProject({
          projectId: project._id,
          principalId: principalId,
          // Server still validates the name; UI no longer requires retyping it.
          confirmName: project.name,
        }),
        'Deleting this project is taking longer than expected. Check your connection and try again.',
      )

      detachDeletedProjectFromUi(deletedProjectId)
      navigateTo({ to: "projects" }, { replace: true })

      await cleanupDeletedProjectLocally(deletedProjectId, {
        keepLocalFiles,
        projectSlug: project.slug,
      })
    } catch (error) {
      const presentation = formatProjectDeleteError(error)
      const message = presentation.detail
        ? `${presentation.message} ${presentation.detail}`
        : presentation.message
      await window.electronAPI.dialog.showMessageBox({
        type: 'error',
        title: 'Delete Failed',
        message: 'Failed to delete project',
        detail: message,
      })
    } finally {
      setIsDeleting(false)
    }
  }, [principalId, navigate, project, removeProject])

  // The sidebar's General / Danger entries select a section; bring it into view.
  const generalSectionRef = useRef<HTMLElement | null>(null)
  const dangerSectionRef = useRef<HTMLElement | null>(null)
  const projectLoaded = Boolean(project)
  useEffect(() => {
    // Only a requested section scrolls. General is the top of the page, and
    // scrolling to it pushed the page title out of view on every open.
    if (!projectLoaded || requestedSection !== 'danger') return
    dangerSectionRef.current?.scrollIntoView({ block: 'start' })
  }, [projectLoaded, requestedSection])

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
        className="relative flex h-full w-full flex-col overflow-hidden bg-background"
      >
        <div className="flex-1 min-h-0">
          <ScrollArea className="scroll-fade-y h-full">
            <div className="w-full min-h-full px-8 sm:px-10 pt-6 pb-12 mx-auto max-w-4xl">
              <div className="mb-6 flex items-start justify-between gap-4">
                <SettingsPageHeader
                  title={project.name}
                  className="mb-0 min-w-0 flex-1"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-xs"
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
              <div className="w-full space-y-6">
                <section id="project-settings-general" ref={generalSectionRef}>
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
                        <Input id="slug" value={project.slug || ''} disabled className="h-7 w-[180px] shrink-0 border-0 border-none bg-transparent px-0 text-xs font-normal text-foreground shadow-none opacity-50 cursor-not-allowed text-right dark:bg-transparent" />
                      </SettingsRowControl>
                    </SettingsRow>
                    {saveError ? (
                      <div className="border-t border-border/40 px-4 py-3">
                        <p className="text-xs text-destructive">{saveError}</p>
                      </div>
                    ) : null}
                  </SettingsGroup>
                </section>
                <section>
                  <SettingsSectionTitle>{t('settings.section.organization')}</SettingsSectionTitle>
                  <SettingsGroup>
                    <SettingsRow isFirst>
                      <SettingsRowLabel
                        title={projectOrg?.name ?? t('settings.label.noOrganization')}
                        description={t('settings.desc.organization')}
                      />
                      <SettingsRowControl>
                        {project?.organizationId ? null : (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 shrink-0 bg-background/50 text-xs"
                            disabled={!principalId || !canEditGeneral}
                            onClick={() => {
                              setOrgError(null)
                              setShowOrgAttach(true)
                            }}
                          >
                            {t('settings.action.attachOrganization')}
                          </Button>
                        )}
                      </SettingsRowControl>
                    </SettingsRow>
                    {orgError ? (
                      <div className="border-t border-border/40 px-4 py-3">
                        <p className="text-xs text-destructive">{orgError}</p>
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
                          <PublishedDevAppIcon
                            name={orgDevApp.name}
                            logoDataUrl={orgDevApp.logoDataUrl}
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
                              <span className="shrink-0 rounded-md bg-background/70 px-1.5 py-0.5 text-2xs font-medium tabular-nums text-muted-foreground">
                                V{orgDevApp.version}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {t('settings.desc.localDevAppIdentity')}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-7 shrink-0 bg-background/50 text-xs"
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

                <SessionRecoveryPanel key={String(project._id)} projectId={String(project._id)} />

                <section id="project-settings-danger" ref={dangerSectionRef}>
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
                          className="h-7 text-xs text-orange-500 hover:text-orange-600 bg-background/50 border-destructive/20"
                          disabled={!principalId || !isManager || project.status === 'archived' || isArchiving}
                          onClick={async () => {
                            const result = await window.electronAPI.dialog.showMessageBox({
                              type: 'warning',
                              title: t('settings.dialog.archive.title'),
                              message: `${t('settings.dialog.archive.title')}?`,
                              detail: t('settings.dialog.archive.desc'),
                              buttons: [t('settings.dialog.archive.action'), t('settings.action.cancel')],
                              defaultId: 0,
                              cancelId: 1,
                              noLink: true,
                            })
                            if (result.response === 0) {
                              void handleArchive()
                            }
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
                          disabled={!principalId || isDeleting}
                          className="h-7 text-xs"
                          onClick={async () => {
                            const { confirmed, keepLocalFiles } = await confirmProjectDeletion({
                              projectId: String(project._id),
                              projectName: project.name,
                            })
                            if (confirmed) {
                              void handleDelete({ keepLocalFiles })
                            }
                          }}
                        >
                          <HugeiconsIcon icon={__Trash2HugeIcon} className="mr-1.5 h-4 w-4" />
                          {isDeleting ? 'Deleting...' : t('settings.action.delete')}
                        </Button>
                      </SettingsRowControl>
                    </SettingsRow>
                  </SettingsDangerGroup>
                </section>
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>

      {project && showOrgAttach ? (
        <Suspense fallback={null}>
          <OrgAttachDialog
            open
            projectName={project.name}
            onOpenChange={(open) => {
              if (!open) {
                setShowOrgAttach(false)
                setOrgError(null)
              }
            }}
            onAttach={async (organizationId) => {
              if (!project) return
              try {
                await attachProjectToOrg({ organizationId, projectId: project._id })
                setShowOrgAttach(false)
                setOrgError(null)
              } catch (error) {
                setOrgError(cleanConvexError(error, 'Could not attach this project.'))
              }
            }}
            onCreate={async (name) => {
              if (!project) return
              try {
                await createAndAttachProjectOrg({ projectId: project._id, name })
                setShowOrgAttach(false)
                setOrgError(null)
              } catch (error) {
                setOrgError(cleanConvexError(error, 'Could not attach this project.'))
              }
            }}
            confirmAttachLabel="Attach"
            confirmCreateLabel="Create & Attach"
          />
        </Suspense>
      ) : null}
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
                if (!principalId) return
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
    </>
  )
}
