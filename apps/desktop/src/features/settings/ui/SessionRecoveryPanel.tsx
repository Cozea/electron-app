import { useCallback, useEffect, useRef, useState } from "react"
import type {
  ProjectdRecoveryConflictKind,
  ProjectdRecoveryPreviewEntry,
  ProjectdRecoveryPreviewResult,
  ProjectdSessionRecoveryEntry,
} from "@cozea/projectd-protocol"
import type { ProjectdRecoveryPreviewBridge } from "@shared/projectdRecoveryPreviewApi"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  SettingsGroup,
  SettingsGroupError,
  SettingsGroupSuccess,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from "@/features/settings/ui/SettingsChrome"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, RefreshIcon as __RefreshHugeIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

interface SessionRecoveryPanelProps {
  projectId: string
}

type RecoverySessionsApi = typeof window.electronAPI.projectd.sessions & ProjectdRecoveryPreviewBridge

function recoveryDescription(entry: ProjectdSessionRecoveryEntry): string {
  if (entry.descriptorState === "unreadable") return "Unreadable recovery record"
  if (!entry.hasRetainedKey) return "Recovery key missing locally"
  if (entry.requiresOnlineVerification) return "Requires online verification"

  const parts: string[] = []
  if (entry.snapshotSequence !== null) {
    parts.push("Local snapshot recorded")
  } else {
    parts.push(entry.source === "left" ? "Retained after leaving" : "Retained on this Mac")
  }

  const pending = entry.pendingBatches + entry.pendingBinaryVersions
  if (pending > 0) {
    parts.push(`${pending} pending change${pending === 1 ? "" : "s"}`)
  }

  return parts.join(" · ")
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "size unavailable"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`
}

function conflictLabel(kind: ProjectdRecoveryConflictKind): string {
  switch (kind) {
    case "path_collision": return "path collision"
    case "concurrent_rename": return "concurrent rename"
    case "delete_modify": return "delete/modify"
    case "binary_concurrent_revision": return "binary versions"
  }
}

function recoveryEntryMeta(entry: ProjectdRecoveryPreviewEntry): string {
  const identity = entry.fileId ? `id ${entry.fileId.slice(0, 8)}` : "pending file"
  const details = [entry.kind, identity, `mode 0o${entry.mode.toString(8)}`]
  if (entry.deleted) details.push("deleted")
  if (entry.size !== null) details.push(formatBytes(entry.size))
  if (entry.kind === "binary" && entry.revisionCount > 0) details.push(`${entry.revisionCount} retained revision${entry.revisionCount === 1 ? "" : "s"}`)
  if (entry.pendingBinaryVersions > 0) details.push(`${entry.pendingBinaryVersions} staged version${entry.pendingBinaryVersions === 1 ? "" : "s"}`)
  return details.join(" · ")
}

function RecoveryPreview({
  preview,
  loading,
  error,
  onLoadMore,
  onRefresh,
}: {
  preview: ProjectdRecoveryPreviewResult | undefined
  loading: boolean
  error: string | undefined
  onLoadMore: (cursor: string) => void
  onRefresh: () => void
}) {
  if (!preview && loading) return <p className="text-xs text-muted-foreground">Reading encrypted retained state on this Mac…</p>
  if (!preview && error) return <div className="space-y-2">
    <p role="alert" className="text-xs text-destructive">{error}</p>
    <Button variant="outline" size="sm" onClick={onRefresh}>Retry preview</Button>
  </div>
  if (!preview) return null

  const conflictTotal = preview.conflicts.pathCollisions + preview.conflicts.concurrentRenames + preview.conflicts.deleteModify + preview.conflicts.binary
  return <div className="space-y-3" aria-live="polite">
    <p className="text-xs leading-relaxed text-muted-foreground">
      Inspect only. This reads the encrypted local snapshot and pending journal on this Mac. It does not open the workspace, contact the session, fetch Git, or change shared state.
    </p>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>{preview.totalEntries} retained {preview.totalEntries === 1 ? "identity" : "identities"}</span>
      <span>{preview.snapshotSequence === null ? "No full snapshot" : `Snapshot sequence ${preview.snapshotSequence}`}</span>
      <span>{preview.pendingBatches} pending {preview.pendingBatches === 1 ? "batch" : "batches"}</span>
      <span>{preview.pendingBinaryVersions} staged binary {preview.pendingBinaryVersions === 1 ? "version" : "versions"}</span>
      <span>{conflictTotal === 0 ? "No retained conflicts detected" : `${conflictTotal} retained conflict${conflictTotal === 1 ? "" : "s"}`}</span>
    </div>
    {conflictTotal > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">
      Conflicts in retained state: {preview.conflicts.pathCollisions} path collision, {preview.conflicts.concurrentRenames} concurrent rename, {preview.conflicts.deleteModify} delete/modify, {preview.conflicts.binary} binary.
    </p>}
    <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
      {preview.entries.map((entry) => <div key={entry.cursor} className="rounded-lg border border-border/50 bg-background/40 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className={entry.deleted ? "min-w-0 break-all font-mono text-xs text-muted-foreground line-through" : "min-w-0 break-all font-mono text-xs text-foreground"}>{entry.path}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{recoveryEntryMeta(entry)}</span>
        </div>
        {entry.conflictKinds.length > 0 && <div className="mt-1 flex flex-wrap gap-1">
          {entry.conflictKinds.map((kind) => <span key={kind} className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">{conflictLabel(kind)}</span>)}
        </div>}
        {entry.kind === "text" && entry.textPreview !== null && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-foreground/90">{entry.textPreview}{entry.textTruncated ? "\n… preview truncated" : ""}</pre>}
        {entry.kind === "symlink" && entry.symlinkTarget !== null && <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">→ {entry.symlinkTarget}{entry.symlinkTargetTruncated ? "…" : ""}</p>}
        {entry.kind === "binary" && <p className="mt-2 text-[11px] text-muted-foreground">Binary payload bytes are not loaded for this preview. {formatBytes(entry.size)} retained metadata is shown above.</p>}
      </div>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {preview.nextCursor && <Button variant="outline" size="sm" disabled={loading} onClick={() => onLoadMore(preview.nextCursor!)}>
        {loading ? "Loading…" : "Load more"}
      </Button>}
      <Button variant="ghost" size="sm" disabled={loading} onClick={onRefresh}>Refresh preview</Button>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  </div>
}

/** Device-local discovery works without a live session or cloud connection. */
export function SessionRecoveryPanel({ projectId }: SessionRecoveryPanelProps) {
  const sessionsApi = window.electronAPI.projectd.sessions as RecoverySessionsApi
  const [cloudSessionId, setCloudSessionId] = useState("")
  const [entries, setEntries] = useState<ProjectdSessionRecoveryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)
  const [expandedPreview, setExpandedPreview] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, ProjectdRecoveryPreviewResult | undefined>>({})
  const [previewErrors, setPreviewErrors] = useState<Record<string, string | undefined>>({})
  const busy = exporting !== null || sharing !== null
  const [notice, setNotice] = useState<string | null>(null)
  const retryExport = useRef<{ publicSessionId: string; source: "local" | "cloud" | "share" } | null>(null)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    retryExport.current = null
    const current = ++generation.current
    setLoading(true)
    setError(null)
    setEntries([])
    setExpandedPreview(null)
    setPreviewing(null)
    setPreviews({})
    setPreviewErrors({})
    try {
      const result = await window.electronAPI.projectd.sessions.listRecovery()
      if (current !== generation.current) return
      if (!result.success) throw new Error(result.error)
      setEntries(result.entries)
    } catch (failure) {
      if (current === generation.current) {
        setError(failure instanceof Error ? failure.message : "Could not read recovery records on this Mac.")
      }
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    void refresh()
    return () => { generation.current++ }
  }, [refresh])
  const projectEntries = entries.filter((entry) => entry.projectId === projectId)
  const unreadable = entries.filter((entry) => entry.descriptorState === "unreadable")

  const loadPreview = async (publicSessionId: string, afterCursor?: string) => {
    const current = generation.current
    setExpandedPreview(publicSessionId)
    setPreviewing(publicSessionId)
    setPreviewErrors((previous) => ({ ...previous, [publicSessionId]: undefined }))
    try {
      const response = await sessionsApi.previewRecovery(publicSessionId, afterCursor, 40)
      if (current !== generation.current) return
      if (!response.success) throw new Error(response.error)
      setPreviews((previous) => {
        const existing = previous[publicSessionId]
        if (!afterCursor || !existing) return { ...previous, [publicSessionId]: response.preview }
        const mergedByCursor = new Map(existing.entries.map((entry) => [entry.cursor, entry]))
        for (const entry of response.preview.entries) mergedByCursor.set(entry.cursor, entry)
        return {
          ...previous,
          [publicSessionId]: {
            ...response.preview,
            entries: [...mergedByCursor.values()],
          },
        }
      })
    } catch (failure) {
      if (current === generation.current) {
        setPreviewErrors((previous) => ({
          ...previous,
          [publicSessionId]: failure instanceof Error ? failure.message : "Could not inspect retained state.",
        }))
      }
    } finally {
      if (current === generation.current) setPreviewing(null)
    }
  }

  const exportEntry = async (entry: Pick<ProjectdSessionRecoveryEntry, "publicSessionId">, source: "local" | "cloud" = "local") => {
    const current = generation.current
    retryExport.current = { publicSessionId: entry.publicSessionId, source }
    setExporting(entry.publicSessionId)
    setError(null)
    setNotice(null)
    try {
      const response = await window.electronAPI.projectd.sessions.exportRecovery(entry.publicSessionId, source, projectId)
      if (current !== generation.current) return
      if (!response.success) throw new Error(response.error)
      retryExport.current = null
      if (!response.canceled) {
        const result = response.result
        setNotice(`Exported ${source === "cloud" ? "cloud snapshot data" : "retained local data"} to ${result.directory}.${source === "cloud" ? " Unsent local changes are not included." : ""}${result.pendingOnly ? " Only pending changes or binary versions were available; a full snapshot was not retained locally." : ""}${result.missingBinaryContents
          ? ` ${result.missingBinaryContents} binary contents were unavailable; see manifest.json.` : ""}${result.pendingBinaryVersions ? ` ${result.pendingBinaryVersions} staged binary versions are in pending-binaries/.` : ""}${result.projectOmissions
          ? ` ${result.projectOmissions} paths were omitted from the project copy; retained variants and details are listed in manifest.json.` : ""}`)
      }
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : "Could not export retained files.")
    } finally {
      if (current === generation.current) setExporting(null)
    }
  }

  const shareKeys = async (publicSessionId: string) => {
    const current = generation.current
    retryExport.current = { publicSessionId, source: "share" }
    setSharing(publicSessionId)
    setError(null)
    setNotice(null)
    try {
      const response = await window.electronAPI.projectd.sessions.shareRecoveryKeys(publicSessionId, projectId)
      if (current !== generation.current) return
      if (!response.success) throw new Error(response.error)
      retryExport.current = null
      setNotice(response.shared > 0 ? `Shared ${response.shared} recovery key copies with existing authorized members. They can retry cloud recovery.` : "No missing key copies were found among currently authorized members.")
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : "Could not share recovery keys. Retry to finish any remaining copies.")
    } finally {
      if (current === generation.current) setSharing(null)
    }
  }

  return (
    <section aria-label="Collaboration recovery" aria-busy={loading}>
      <div className="flex items-start justify-between gap-4 pb-1">
        <div>
          <SettingsSectionTitle className="mb-1">Collaboration recovery</SettingsSectionTitle>
          <SettingsSectionDescription className="mb-2.5">
            Inspect or export local retained data, or retrieve a paused or closed session’s cloud snapshot.
          </SettingsSectionDescription>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          disabled={loading || busy}
          onClick={() => {
            const retry = error ? retryExport.current : null
            if (retry?.source === "share") void shareKeys(retry.publicSessionId)
            else if (retry) void exportEntry(retry, retry.source)
            else void refresh()
          }}
        >
          <HugeiconsIcon
            icon={__RefreshHugeIcon}
            className={cn("h-3 w-3", loading && "animate-spin")}
          />
          {loading ? "Loading…" : error ? "Retry" : "Refresh"}
        </Button>
      </div>

      <SettingsGroup>
        <SettingsRow isFirst>
          <SettingsRowLabel
            title="Cloud snapshot recovery"
            description="Retrieve a paused or closed session snapshot."
            htmlFor="cloud-session-id"
          />
          <SettingsRowControl className="flex items-center gap-2">
            <Input
              id="cloud-session-id"
              aria-label="Session ID for cloud recovery"
              placeholder="Session ID (czs_…)"
              value={cloudSessionId}
              onChange={(event) => setCloudSessionId(event.target.value.trim())}
              disabled={busy}
              className="h-8 w-52 font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 text-xs"
              disabled={busy || !/^czs_[a-f0-9]{16}$/.test(cloudSessionId)}
              onClick={() => { void exportEntry({ publicSessionId: cloudSessionId }, "cloud") }}
            >
              {exporting === cloudSessionId ? "Recovering…" : "Recover"}
            </Button>
          </SettingsRowControl>
        </SettingsRow>

        <SettingsRow>
          <SettingsRowLabel
            title="Share recovery keys"
            description="Share local recovery keys with session members."
          />
          <SettingsRowControl>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 text-xs"
              disabled={busy || !/^czs_[a-f0-9]{16}$/.test(cloudSessionId)}
              onClick={() => { void shareKeys(cloudSessionId) }}
            >
              {sharing ? "Sharing…" : "Share keys"}
            </Button>
          </SettingsRowControl>
        </SettingsRow>

        {projectEntries.length === 0 && !loading && (
          <SettingsRow>
            <SettingsRowLabel
              title="Local retained records"
              description="No local recovery records found for this project."
            />
          </SettingsRow>
        )}

        {projectEntries.map((entry) => {
          const hasLocalState = entry.snapshotSequence !== null || entry.pendingBatches > 0 || entry.pendingBinaryVersions > 0
          const expanded = expandedPreview === entry.publicSessionId
          return (
            <div key={entry.publicSessionId}>
              <SettingsRow>
                <SettingsRowLabel
                  title={
                    <span className="flex items-center gap-2">
                      <span>{entry.branchName ?? entry.publicSessionId}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Local record
                      </span>
                    </span>
                  }
                  description={
                    entry.branchName
                      ? `${entry.publicSessionId} · ${recoveryDescription(entry)}`
                      : recoveryDescription(entry)
                  }
                />
                <SettingsRowControl className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={busy || previewing === entry.publicSessionId || !entry.hasRetainedKey || !hasLocalState}
                    onClick={() => {
                      if (expanded) setExpandedPreview(null)
                      else if (previews[entry.publicSessionId]) setExpandedPreview(entry.publicSessionId)
                      else void loadPreview(entry.publicSessionId)
                    }}
                  >
                    {previewing === entry.publicSessionId ? "Inspecting…" : expanded ? "Hide" : "Inspect"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1.5"
                        disabled={busy}
                      >
                        <span>{exporting === entry.publicSessionId ? "Exporting…" : "Export"}</span>
                        <HugeiconsIcon icon={ArrowDown01Icon} className="h-3 w-3 opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        disabled={busy || !entry.hasRetainedKey || !hasLocalState}
                        onClick={() => { void exportEntry(entry) }}
                      >
                        Export retained files
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={busy}
                        onClick={() => { void exportEntry(entry, "cloud") }}
                      >
                        Export cloud snapshot
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SettingsRowControl>
              </SettingsRow>
              {expanded && (
                <div className="border-t border-border/30 px-6 py-4">
                  <RecoveryPreview
                    preview={previews[entry.publicSessionId]}
                    loading={previewing === entry.publicSessionId}
                    error={previewErrors[entry.publicSessionId]}
                    onLoadMore={(cursor) => { void loadPreview(entry.publicSessionId, cursor) }}
                    onRefresh={() => { void loadPreview(entry.publicSessionId) }}
                  />
                </div>
              )}
            </div>
          )
        })}

        {error && <SettingsGroupError>{error}</SettingsGroupError>}
        {notice && <SettingsGroupSuccess>{notice}</SettingsGroupSuccess>}
      </SettingsGroup>

      {unreadable.length > 0 && (
        <div className="mt-4 space-y-2">
          <SettingsSectionDescription>
            These unreadable records could not be assigned to a project.
          </SettingsSectionDescription>
          <SettingsGroup>
            {unreadable.map((entry, index) => (
              <SettingsRow key={entry.publicSessionId} isFirst={index === 0}>
                <SettingsRowLabel
                  title={
                    <span className="flex items-center gap-2 font-mono text-xs">
                      <span>{entry.publicSessionId}</span>
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-destructive">
                        Unreadable
                      </span>
                    </span>
                  }
                  description={recoveryDescription(entry)}
                />
              </SettingsRow>
            ))}
          </SettingsGroup>
        </div>
      )}
    </section>
  )
}
