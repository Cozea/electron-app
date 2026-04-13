import { WorkspaceAccessNotice } from "@/components/workspaces/WorkspaceAccessNotice"
import { BillingContent } from "@/pages/workspace/billing/BillingContent"
import { useBillingController } from "@/pages/workspace/billing/useBillingController"

interface BillingProps {
  surface?: "page" | "drawer"
  route?: string
}

export function Billing({ surface = "page", route }: BillingProps) {
  const controller = useBillingController({ surface, route })

  const content = controller.settingsPage.isWorkspaceAccessDenied ? (
    <WorkspaceAccessNotice
      title="Billing access required"
      description="You do not have permission to view workspace billing and usage for this workspace."
    />
  ) : (
    <BillingContent controller={controller} surface={surface} />
  )

  return content
}
