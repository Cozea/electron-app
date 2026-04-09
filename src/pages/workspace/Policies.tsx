import { AdjustmentsHorizontalIcon as SlidersHorizontal, LockClosedIcon as Lock, ShieldCheckIcon as ShieldCheck } from "@heroicons/react/24/outline"

import { WorkspaceAccessNotice } from '@/components/workspaces/WorkspaceAccessNotice'
import { Badge } from '@/components/ui/badge'
import { CardTitle } from '@/components/ui/card'
import { useScopedPoliciesData } from '@/hooks/useScopedPoliciesData'

const POLICY_CARDS = [
  {
    title: 'Sharing and join rules',
    description:
      'Define who can create join links, whether external sharing is allowed, and whether project access requires approval.',
    icon: ShieldCheck,
  },
  {
    title: 'Workspace defaults',
    description:
      'Control default project visibility, ownership defaults, import behavior, and other workspace-wide operating defaults.',
    icon: SlidersHorizontal,
  },
  {
    title: 'Retention and governance',
    description:
      'Set audit retention, cleanup behavior, storage governance, and other policy rules for the workspace.',
    icon: Lock,
  },
]

interface PoliciesProps {
  surface?: 'page' | 'drawer'
  route?: string
}

export function Policies({ surface = 'page', route }: PoliciesProps = {}) {
  const { settingsPage, workspaceName } = useScopedPoliciesData({ route })

  const content = (
    <>
      {settingsPage.isWorkspaceAccessDenied ? (
        <WorkspaceAccessNotice
          title="Policies access required"
          description="You do not have permission to view workspace policies."
        />
      ) : (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl bg-secondary/80 px-5 py-4 dark:bg-secondary/40">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/60 text-muted-foreground">
            <Lock className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Policies</h1>
            <p className="text-sm text-muted-foreground">
              Define how the workspace operates. Policies are separate from permissions and do
              not control who can use a capability.
            </p>
            {workspaceName ? (
              <p className="text-xs text-muted-foreground">
                Workspace:{' '}
                <span className="font-medium text-foreground">
                  {workspaceName}
                </span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl bg-secondary/80 dark:bg-secondary/40">
          <div className="border-b border-border/60 px-5 py-4">
            <CardTitle className="text-base">Workspace governance</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Policy controls will live here. They govern sharing, defaults, and retention for the
              workspace as a whole.
            </p>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-3">
            {POLICY_CARDS.map((policy) => {
              const Icon = policy.icon
              return (
                <div
                  key={policy.title}
                  className="rounded-2xl border border-border/60 bg-background/40 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/80 text-muted-foreground dark:bg-secondary/40">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="font-medium">{policy.title}</div>
                    </div>
                    <Badge variant="outline">Coming soon</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{policy.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      )}
    </>
  )

  if (surface === 'drawer') {
    return content
  }

  return content
}
