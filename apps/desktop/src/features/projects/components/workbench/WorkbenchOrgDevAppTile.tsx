import { useEffect, useMemo, useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview-react"
import { useQuery } from "convex/react"

import { api } from "../../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { BrowserUnavailableSurface } from "@/features/projects/components/workbench/BrowserUnavailableSurface"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import type { WorkbenchOrgDevAppTile as WorkbenchOrgDevAppTileRecord } from "@/stores/useProjectWorkbenchStore"
import { useTranslation } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { OrgDevAppRuntimeState } from "@shared/orgDevAppRuntime"
import type { OrgDevAppEnvironmentStatus } from "@shared/orgDevAppEnvironment"

interface WorkbenchOrgDevAppTileProps {
  projectId: string
  laneId: string
  tile: WorkbenchOrgDevAppTileRecord
  workspaceId: string | null
  workbenchSessionKey: string | null
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
}

export function WorkbenchOrgDevAppTile({
  tile,
  panelApi,
  containerApi,
}: WorkbenchOrgDevAppTileProps) {
  const { t } = useTranslation()
  const { convexUserId } = useAuth()
  const [prepareError, setPrepareError] = useState<string | null>(null)
  const [originUrl, setOriginUrl] = useState("")
  const [prepareAttempt, setPrepareAttempt] = useState(0)
  const [serviceApproved, setServiceApproved] = useState(false)
  const [serviceNeedsApproval, setServiceNeedsApproval] = useState(false)
  const [runtimeState, setRuntimeState] = useState<OrgDevAppRuntimeState | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [environmentStatus, setEnvironmentStatus] = useState<OrgDevAppEnvironmentStatus | null>(null)
  const [environmentValues, setEnvironmentValues] = useState<Record<string, string>>({})
  const [showConfiguration, setShowConfiguration] = useState(false)
  const [servicePermissions, setServicePermissions] = useState<{ network: boolean; persistentData: boolean } | null>(null)

  const artifact = useQuery(
    api.devApps.getArtifactUrl,
    convexUserId && tile.publicationId
      ? {
          publicationId: tile.publicationId as Id<"devAppPublications">,
        }
      : "skip",
  )

  useEffect(() => {
    if (artifact === null) {
      setOriginUrl("")
      setPrepareError(t("orgDevApp.open.accessLost"))
      if (tile.runtimeKind === "service") {
        void window.electronAPI.orgDevApp.stopRuntime({ contentHash: tile.contentHash, publicationId: tile.publicationId })
      }
      return
    }
    if (!artifact) return
    let cancelled = false
    setPrepareError(null)
    void window.electronAPI.orgDevApp
      .prepareArtifact({
        downloadUrl: artifact.url,
        contentHash: artifact.contentHash,
        entryPath: artifact.entryPath,
        runtimeKind: artifact.runtimeKind,
      })
      .then(async (result) => {
        if (cancelled) return
        if (!result.success) {
          setPrepareError(result.error)
          return
        }
        if (result.runtimeKind === "service") {
          setServicePermissions(result.servicePermissions ?? null)
          const permissionSetHash = artifact.permissionSetHash
          if (!permissionSetHash) throw new Error("The Service DevApp permission metadata is missing.")
          const environment = await window.electronAPI.orgDevApp.getRuntimeEnvironment({
            contentHash: artifact.contentHash,
            publicationId: tile.publicationId,
          })
          if (!environment.success) throw new Error(environment.error)
          setEnvironmentStatus(environment.status)
          if (environment.status.missingRequired.length > 0) {
            setShowConfiguration(true)
            return
          }
          const trust = await window.electronAPI.orgDevApp.getRuntimeTrust({
            contentHash: artifact.contentHash,
            publicationId: tile.publicationId,
            permissionSetHash,
          })
          if (!trust.success) throw new Error(trust.error)
          if (trust.trusted && !serviceApproved) setServiceApproved(true)
          if (!trust.trusted && !serviceApproved) {
            setServiceNeedsApproval(true)
            return
          }
          setServiceNeedsApproval(false)
          const started = await window.electronAPI.orgDevApp.startRuntime({
            contentHash: artifact.contentHash,
            publicationId: tile.publicationId,
            permissionSetHash,
            leaseId: tile.id,
          })
          if (!started.success) throw new Error(started.error)
          setRuntimeState(started.state)
          if (started.state.status !== "ready" || !started.state.originUrl) {
            throw new Error(started.state.error ?? "The Service DevApp did not start.")
          }
          if (!cancelled) setOriginUrl(started.state.originUrl)
          return
        }
        setServiceNeedsApproval(false)
        setOriginUrl(result.originUrl)
      })
      .catch((error) => {
        if (cancelled) return
        setPrepareError(error instanceof Error ? error.message : t("orgDevApp.open.failed"))
      })
    return () => {
      cancelled = true
    }
  }, [artifact, prepareAttempt, serviceApproved, t, tile.id, tile.publicationId])

  useEffect(() => () => {
    if (tile.runtimeKind !== "service") return
    void window.electronAPI.orgDevApp.releaseRuntime({
      contentHash: tile.contentHash,
      publicationId: tile.publicationId,
      leaseId: tile.id,
    })
  }, [tile.contentHash, tile.id, tile.publicationId, tile.runtimeKind])

  useEffect(() => {
    if (artifact?.runtimeKind !== "service" || !serviceApproved) return
    let cancelled = false
    const refresh = async () => {
      const result = await window.electronAPI.orgDevApp.getRuntimeState({
        contentHash: artifact.contentHash,
        publicationId: tile.publicationId,
      })
      if (cancelled || !result.success) return
      setRuntimeState(result.state)
      if (result.state.status === "failed") {
        setOriginUrl("")
        setPrepareError(result.state.error ?? "The Service DevApp stopped unexpectedly.")
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), showLogs ? 1_000 : 2_500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [artifact?.contentHash, artifact?.runtimeKind, serviceApproved, showLogs, tile.publicationId])

  const statusMessage = useMemo(() => {
    if (prepareError) return prepareError
    if (serviceNeedsApproval) return "This Service DevApp runs trusted organization code on this Mac."
    if (!originUrl) return artifact?.runtimeKind === "service" ? "Starting Service DevApp…" : t("orgDevApp.open.preparing")
    return null
  }, [artifact?.runtimeKind, originUrl, prepareError, serviceNeedsApproval, t])

  return (
    <WorkbenchTileChrome
      title={tile.title}
      panelApi={panelApi}
      containerApi={containerApi}
      chromeVariant="pill"
      tileType="orgDevApp"
      devAppId={tile.publicationId}
      logoDataUrl={tile.logoDataUrl}
      hideTitlePill={false}
      actions={artifact?.runtimeKind === "service" ? (
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setShowLogs((value) => !value)}>
            Logs
          </Button>
          {environmentStatus?.requirements.length ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setShowConfiguration(true)}>
              Configure
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => {
            void window.electronAPI.orgDevApp.stopRuntime({ contentHash: artifact.contentHash, publicationId: tile.publicationId }).then((result) => {
              if (result.success) setRuntimeState(result.state)
              setOriginUrl("")
            })
          }}>
            Stop
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => {
            void window.electronAPI.orgDevApp.stopRuntime({ contentHash: artifact.contentHash, publicationId: tile.publicationId }).finally(() => {
              setOriginUrl("")
              setPrepareAttempt((attempt) => attempt + 1)
            })
          }}>
            Restart
          </Button>
        </div>
      ) : null}
      contentClassName="relative h-full overflow-hidden bg-content-surface"
    >
      {statusMessage ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className={prepareError ? "max-w-md text-sm text-destructive" : "max-w-md text-sm text-muted-foreground"}>
            {statusMessage}
          </p>
          {prepareError && artifact !== null ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPrepareError(null)
                setPrepareAttempt((attempt) => attempt + 1)
              }}
            >
              {t("orgDevApp.open.retry")}
            </Button>
          ) : null}
          {serviceNeedsApproval ? (
            <div className="flex max-w-md flex-col items-center gap-3">
              <p className="text-xs text-muted-foreground">
                Published by {artifact?.publisherDeviceLabel ?? artifact?.publisherIdentityKey ?? "an organization device"}. Node on macOS Apple silicon.
                {servicePermissions?.network ? " Network access requested." : " No network access requested."}
                {servicePermissions?.persistentData ? " Persistent local data requested." : " No persistent local data requested."}
              </p>
              <Button type="button" size="sm" onClick={() => {
                if (!artifact?.permissionSetHash) return
                void window.electronAPI.orgDevApp.approveRuntime({
                  contentHash: artifact.contentHash,
                  publicationId: tile.publicationId,
                  permissionSetHash: artifact.permissionSetHash,
                }).then((result) => {
                  if (!result.success) {
                    setPrepareError(result.error)
                    return
                  }
                  setServiceApproved(true)
                })
              }}>
                Run trusted service
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <BrowserUnavailableSurface description="The DevApp runtime is ready, but its protected embedded surface is offline until the T3 browser port lands." />
      )}
      {showLogs ? (
        <div className="absolute inset-x-4 bottom-4 z-20 max-h-64 overflow-auto bg-background p-3 shadow-xl">
          <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground">
            {(runtimeState?.logs ?? []).join("\n") || "No service output yet."}
          </pre>
        </div>
      ) : null}
      {showConfiguration && environmentStatus ? (
        <div className="absolute inset-0 z-30 overflow-auto bg-background p-6">
          <div className="mx-auto flex max-w-lg flex-col gap-4">
            <div>
              <h3 className="text-sm font-medium">Service configuration</h3>
              <p className="mt-1 text-xs text-muted-foreground">Values stay encrypted on this Mac and are passed only to the service process.</p>
            </div>
            {environmentStatus.requirements.map((requirement) => (
              <label key={requirement.name} className="flex flex-col gap-1.5 text-xs">
                <span className="flex items-center gap-2">
                  <span className="font-mono">{requirement.name}</span>
                  {requirement.required ? <span className="text-destructive">Required</span> : <span className="text-muted-foreground">Optional</span>}
                  {requirement.configured ? <span className="text-muted-foreground">Configured</span> : null}
                </span>
                {requirement.description ? <span className="text-muted-foreground">{requirement.description}</span> : null}
                <Input
                  type={requirement.secret ? "password" : "text"}
                  autoComplete="off"
                  value={environmentValues[requirement.name] ?? ""}
                  placeholder={requirement.configured ? "Leave blank to keep the saved value" : "Enter a value"}
                  onChange={(event) => setEnvironmentValues((current) => ({ ...current, [requirement.name]: event.target.value }))}
                />
              </label>
            ))}
            <div className="flex justify-end gap-2">
              {environmentStatus.missingRequired.length === 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowConfiguration(false)}>Cancel</Button>
              ) : null}
              <Button type="button" size="sm" onClick={() => {
                if (!artifact) return
                const values = Object.fromEntries(Object.entries(environmentValues).filter(([, value]) => value.length > 0))
                void window.electronAPI.orgDevApp.setRuntimeEnvironment({
                  contentHash: artifact.contentHash,
                  publicationId: tile.publicationId,
                  values,
                }).then(async (result) => {
                  if (!result.success) {
                    setPrepareError(result.error)
                    return
                  }
                  setEnvironmentValues({})
                  setEnvironmentStatus(result.status)
                  if (result.status.missingRequired.length > 0) return
                  setShowConfiguration(false)
                  if (runtimeState?.status === "ready") {
                    await window.electronAPI.orgDevApp.stopRuntime({ contentHash: artifact.contentHash, publicationId: tile.publicationId })
                    setOriginUrl("")
                  }
                  setPrepareAttempt((attempt) => attempt + 1)
                })
              }}>Save and restart</Button>
            </div>
          </div>
        </div>
      ) : null}
    </WorkbenchTileChrome>
  )
}
