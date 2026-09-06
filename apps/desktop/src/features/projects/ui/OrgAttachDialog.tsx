import { useEffect, useMemo, useState } from "react"
import { useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
}

export function OrgAttachDialog({
  open,
  projectName,
  onOpenChange,
  onAttach,
  onCreate,
}: OrgAttachDialogProps) {
  const { t } = useTranslation()
  const { principalId } = useAuth()
  const orgs = useQuery(
    api.organizations.listMine,
    principalId ? {} : "skip",
  )
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("orgDevApp.attach.title")}</DialogTitle>
          <DialogDescription>{t("orgDevApp.attach.description")}</DialogDescription>
        </DialogHeader>

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
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
            <div className="flex h-full flex-col justify-start pt-1 space-y-2">
              <div className="rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2.5">
                <label htmlFor="org-name-input" className="block text-[11px] font-medium text-muted-foreground">
                  {t("orgDevApp.attach.name")}
                </label>
                <input
                  id="org-name-input"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Organization name"
                  className="mt-1 h-7 w-full border-0 border-none bg-transparent p-0 text-sm font-normal text-foreground shadow-none outline-none placeholder:text-muted-foreground/60 focus:outline-none focus-visible:border-none focus-visible:ring-0 focus-visible:shadow-none"
                  autoFocus={!hasExistingOrgs}
                />
              </div>
              <p className="px-1 text-xs text-muted-foreground/70">
                You will be the administrator of this organization.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          {mode === "existing" && defaultOrgId ? (
            <Button
              disabled={busy || !defaultOrgId}
              onClick={() => void run(() => onAttach(defaultOrgId))}
            >
              Publish
            </Button>
          ) : (
            <Button
              disabled={busy || !name.trim()}
              onClick={() => void run(() => onCreate(name.trim()))}
            >
              Create & Publish
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
