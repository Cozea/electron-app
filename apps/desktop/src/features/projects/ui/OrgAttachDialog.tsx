import { useEffect, useMemo, useState } from "react"

import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useMyOrganizations } from "@/hooks/useMyOrganizations"
import { Button } from "@/components/ui/button"
import { UnifiedModal, UnifiedModalField } from "@/components/ui/unified-modal"
import { useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon as __CheckIconHugeIcon, Building03Icon as __BuildingIconHugeIcon } from "@hugeicons/core-free-icons"

interface OrgAttachDialogProps {
  open: boolean
  projectName: string
  onOpenChange: (open: boolean) => void
  onAttach: (organizationId: Id<"organizations">) => Promise<void>
  onCreate: (name: string) => Promise<void>
  confirmAttachLabel?: string
  confirmCreateLabel?: string
}

export function OrgAttachDialog({
  open,
  projectName,
  onOpenChange,
  onAttach,
  onCreate,
  confirmAttachLabel = "Publish",
  confirmCreateLabel = "Create & Publish",
}: OrgAttachDialogProps) {
  const { t } = useTranslation()
  const orgs = useMyOrganizations()
  const hasExistingOrgs = (orgs ?? []).length > 0
  const [mode, setMode] = useState<"existing" | "create">("existing")
  const [name, setName] = useState(`${projectName} Org`)
  const [selectedOrgId, setSelectedOrgId] = useState<Id<"organizations"> | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!hasExistingOrgs) {
      setMode("create")
    } else {
      setMode("existing")
    }
  }, [hasExistingOrgs])

  const defaultOrgId = useMemo(() => {
    if (selectedOrgId) return selectedOrgId
    return orgs?.[0]?.organizationId ?? null
  }, [orgs, selectedOrgId])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      title={t("orgDevApp.attach.title")}
      size="md"
      dismissable={!busy}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          {mode === "existing" && defaultOrgId ? (
            <Button
              disabled={busy || !defaultOrgId}
              onClick={() => void run(() => onAttach(defaultOrgId))}
            >
              {confirmAttachLabel}
            </Button>
          ) : (
            <Button
              disabled={busy || !name.trim()}
              onClick={() => void run(() => onCreate(name.trim()))}
            >
              {confirmCreateLabel}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("orgDevApp.attach.description")}</p>

        {hasExistingOrgs ? (
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1">
            <button
              type="button"
              className={cn(
                "rounded-md py-1.5 text-xs font-medium transition-all cursor-pointer",
                mode === "existing"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setMode("existing")}
            >
              Existing organization
            </button>
            <button
              type="button"
              className={cn(
                "rounded-md py-1.5 text-xs font-medium transition-all cursor-pointer",
                mode === "create"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setMode("create")}
            >
              New organization
            </button>
          </div>
        ) : null}

        <div className="h-[180px] w-full py-1">
          {mode === "existing" && hasExistingOrgs ? (
            <div className="h-full space-y-1.5 overflow-y-auto pr-0.5">
              {(orgs ?? []).map((org) => {
                const isSelected = defaultOrgId === org.organizationId
                return (
                  <button
                    key={org.organizationId}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-left text-sm transition-all cursor-pointer",
                      isSelected
                        ? "border-primary/40 bg-accent text-foreground shadow-xs"
                        : "border-border/40 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
                    )}
                    onClick={() => setSelectedOrgId(org.organizationId)}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <HugeiconsIcon icon={__BuildingIconHugeIcon} className="size-4 shrink-0 opacity-70" />
                      <span className="truncate font-medium text-foreground">{org.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {org.role}
                      </span>
                      {isSelected ? (
                        <HugeiconsIcon icon={__CheckIconHugeIcon} className="size-4 shrink-0 text-primary" />
                      ) : (
                        <div className="size-4" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex h-full flex-col justify-start space-y-2 pt-1">
              <UnifiedModalField
                id="org-name-input"
                label={t("orgDevApp.attach.name")}
                value={name}
                onChange={setName}
                autoFocus={!hasExistingOrgs}
              />
              <p className="px-1 text-xs text-muted-foreground/70">
                You will be the administrator of this organization.
              </p>
            </div>
          )}
        </div>

      </div>
    </UnifiedModal>
  )
}
