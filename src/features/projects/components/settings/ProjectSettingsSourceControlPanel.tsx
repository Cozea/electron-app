import { RepositoryProvisioner } from '@/components/git/RepositoryProvisioner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { ProjectRepoAccessStatus } from '@/lib/git/projectRepoAccess'
import {
  supportsVersionControlAutomation,
  type VersionControlSetupMode,
} from '@shared/versionControl'
import type { Doc } from '../../../../../convex/_generated/dataModel'
import { ExclamationCircleIcon as AlertCircle } from "@heroicons/react/24/outline"

import { Switch } from '@/components/ui/switch'

type VersionControlProviderOption = 'github' | 'local'
const COMMON_BRANCH_OPTIONS = ['main', 'develop', 'master']

export interface ProjectSettingsSourceControlPanelProps {
  project: Doc<'projects'>
  isPersonalWorkspace: boolean
  repoAccessStatus: ProjectRepoAccessStatus
  repoIntegration: {
    authStatus?: string | null
    setupMode?: VersionControlSetupMode | null
  } | null
  provider: VersionControlProviderOption
  onProviderChange: (next: VersionControlProviderOption) => void
  onRepoUrlChange: (value: string) => void
  activeCollabBranch: string
  onActiveCollabBranchChange: (value: string) => void
  setupMode: VersionControlSetupMode
  syncPolicy: 'auto' | 'manual'
  onSyncPolicyChange: (next: 'auto' | 'manual') => void
  normalizedRepoUrl: string
  saveError: string | null
  onOpenWorkspaceSourceControlSettings: () => void
}

export function ProjectSettingsSourceControlPanel({
  project,
  repoAccessStatus,
  repoIntegration,
  provider,
  onProviderChange,
  onRepoUrlChange,
  activeCollabBranch,
  onActiveCollabBranchChange,
  setupMode,
  syncPolicy,
  onSyncPolicyChange,
  normalizedRepoUrl,
  saveError,
  onOpenWorkspaceSourceControlSettings,
}: ProjectSettingsSourceControlPanelProps) {
  const showConnectCta =
    repoAccessStatus.state === 'integration_missing' ||
    repoAccessStatus.state === 'integration_mismatch'

  return (
    <div className="mx-auto max-w-5xl">
      {showConnectCta ? (
        <div className="mb-8 flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
              <AlertCircle className="size-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium leading-snug">{repoAccessStatus.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {repoAccessStatus.description}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0 self-start sm:self-center"
            onClick={onOpenWorkspaceSourceControlSettings}
          >
            {repoAccessStatus.state === 'integration_mismatch'
              ? 'Fix in workspace settings'
              : 'Connect in workspace settings'}
          </Button>
        </div>
      ) : null}

      <div className="min-w-0 space-y-8">
          <section>
            <h3 className="px-1 text-xs font-medium text-muted-foreground mb-1.5">
              Source Control
            </h3>
            <div className="flex flex-col overflow-hidden rounded-[14px] bg-muted">
              <div className="flex min-h-[44px] items-center justify-between gap-4 px-4 py-2">
                <div className="flex flex-col gap-0.5 pr-4">
                  <Label htmlFor="sc-provider" className="text-xs font-medium text-foreground">Remote Repository</Label>
                  <p className="text-[11px] text-muted-foreground">Sync your code with a remote git host natively</p>
                </div>
                <Switch
                  id="sc-provider"
                  checked={provider === 'github'}
                  onCheckedChange={(checked) => {
                    onProviderChange(checked ? 'github' : 'local')
                  }}
                />
              </div>
                {supportsVersionControlAutomation(provider) && project.organizationId ? (
                  <RepositoryProvisioner
                    provider={provider}
                    organizationId={project.organizationId}
                    integrationConnected={Boolean(repoIntegration)}
                    setupMode={setupMode}
                    selectedRepoUrl={normalizedRepoUrl}
                    compactTable
                    onRepositorySelected={(repository) => {
                      onRepoUrlChange(repository.url)
                      onActiveCollabBranchChange(repository.defaultBranch || 'main')
                    }}
                  />
                ) : null}
                <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="sc-branch" className="text-xs font-medium text-foreground">Branch</Label>
                    <p className="text-[11px] text-muted-foreground">The default branch to collaborate on</p>
                  </div>
                  <select
                    id="sc-branch"
                    value={activeCollabBranch}
                    onChange={(e) => onActiveCollabBranchChange(e.target.value)}
                    className="h-7 w-[160px] max-w-full rounded-md border border-border/50 bg-transparent px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring/50"
                  >
                    {[activeCollabBranch, ...COMMON_BRANCH_OPTIONS]
                      .filter((value, index, array) => value && array.indexOf(value) === index)
                      .map((branch) => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex min-h-[44px] items-center justify-between gap-4 border-t border-border/40 px-4 py-2">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="sc-sync-policy" className="text-xs font-medium text-foreground">Auto sync</Label>
                    <p className="text-[11px] text-muted-foreground">Automatically sync code changes</p>
                  </div>
                  <Switch
                    id="sc-sync-policy"
                    checked={syncPolicy === 'auto'}
                    onCheckedChange={(checked) => {
                      onSyncPolicyChange(checked ? 'auto' : 'manual')
                    }}
                  />
              </div>
            </div>
          </section>

          {saveError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {saveError}
            </p>
          ) : null}
      </div>
    </div>
  )
}
