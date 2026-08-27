import { useMemo, useState } from "react"
import { useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  const { convexUserId } = useAuth()
  const orgs = useQuery(
    api.organizations.listMine,
    convexUserId ? { userId: convexUserId } : "skip",
  )
  const [name, setName] = useState(`${projectName} Org`)
  const [selectedOrgId, setSelectedOrgId] = useState<Id<"organizations"> | null>(null)
  const [busy, setBusy] = useState(false)
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("orgDevApp.attach.title")}</DialogTitle>
          <DialogDescription>{t("orgDevApp.attach.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {(orgs ?? []).length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground">{t("orgDevApp.attach.existing")}</p>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {(orgs ?? []).map((org) => (
                  <button
                    key={org.organizationId}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm",
                      defaultOrgId === org.organizationId
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60",
                    )}
                    onClick={() => setSelectedOrgId(org.organizationId)}
                  >
                    <span className="truncate">{org.name}</span>
                    <span className="text-[11px] uppercase tracking-wide">{org.role}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className="text-xs font-medium text-foreground">{t("orgDevApp.attach.name")}</label>
          <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8" />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          {defaultOrgId ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void run(() => onAttach(defaultOrgId))}
            >
              {t("orgDevApp.attach.existing")}
            </Button>
          ) : null}
          <Button disabled={busy || !name.trim()} onClick={() => void run(() => onCreate(name.trim()))}>
            {t("orgDevApp.attach.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
