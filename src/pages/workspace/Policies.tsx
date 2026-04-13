import { AdjustmentsHorizontalIcon as SlidersHorizontal, LockClosedIcon as Lock, ShieldCheckIcon as ShieldCheck } from "@heroicons/react/24/outline"

import {
  SettingsGroup,
  SettingsPageBody,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from '@/components/settings/SettingsChrome'
import { WorkspaceAccessNotice } from '@/components/workspaces/WorkspaceAccessNotice'
import { Badge } from '@/components/ui/badge'
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
      <div className="space-y-5">
        <div className="min-w-0">
          <SettingsSectionTitle className="px-0">Policies</SettingsSectionTitle>
          <SettingsSectionDescription className="mb-0 px-0">
            Set workspace-wide rules for sharing, defaults, and governance.
          </SettingsSectionDescription>
          {workspaceName ? (
            <p className="mt-2 px-0 text-[11px] text-muted-foreground">
              Workspace: {workspaceName}
            </p>
          ) : null}
        </div>

        {POLICY_CARDS.map((policy) => {
          const Icon = policy.icon
          return (
            <SettingsGroup key={policy.title}>
              <SettingsRow isFirst>
                <SettingsRowLabel
                  title={
                    <span className="inline-flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{policy.title}</span>
                    </span>
                  }
                  description={policy.description}
                />
                <SettingsRowControl>
                  <Badge variant="outline" className="font-normal">
                    Coming soon
                  </Badge>
                </SettingsRowControl>
              </SettingsRow>
            </SettingsGroup>
          )
        })}
      </div>
      )}
    </>
  )

  if (surface === 'drawer') {
    return content
  }

  return <SettingsPageBody>{content}</SettingsPageBody>
}
