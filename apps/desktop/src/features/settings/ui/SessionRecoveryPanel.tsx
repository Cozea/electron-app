import { useCallback, useEffect, useRef, useState } from "react"
import type { ProjectdSessionRecoveryEntry } from "@cozea/projectd-protocol"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SettingsGroup, SettingsRow, SettingsRowLabel, SettingsRowControl, SettingsSectionTitle } from "@/features/settings/ui/SettingsChrome"

interface SessionRecoveryPanelProps {
  projectId: string
}

function recoveryDescription(entry: ProjectdSessionRecoveryEntry): string {
  if (entry.descriptorState === "unreadable") return "This Mac cannot read the retained recovery record. Its data has been kept."
  const details = [entry.source === "left" ? "Retained after leaving the session." : "Retained on this Mac."]
  if (entry.requiresOnlineVerification) details.push("Online verification is required before reopening. Retained files can still be exported.")
  if (entry.pendingBinaryVersions > 0) details.push(`${entry.pendingBinaryVersions} binary versions are retained for upload.`)
  if (entry.pendingBatches > 0) details.push("Some changes have not been confirmed by the session.")
  if (entry.snapshotSequence !== null) details.push("A local snapshot is recorded.")
  if (!entry.hasRetainedKey) details.push("The recovery key is not available locally.")
  return details.join(" ")
}

/** Device-local discovery works without a live session or cloud connection. */
export function SessionRecoveryPanel({ projectId }: SessionRecoveryPanelProps) {
  const [cloudSessionId, setCloudSessionId] = useState("")
  const [entries, setEntries] = useState<ProjectdSessionRecoveryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)
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

  return <section aria-label="Collaboration recovery" aria-busy={loading}>
    <div className="flex items-center justify-between gap-3">
      <SettingsSectionTitle>Collaboration recovery</SettingsSectionTitle>
      <Button variant="outline" size="sm" disabled={loading || busy} onClick={() => {
        const retry = error ? retryExport.current : null
        if (retry?.source === "share") void shareKeys(retry.publicSessionId)
        else if (retry) void exportEntry(retry, retry.source)
        else void refresh()
      }}>
        {loading ? "Loading…" : error ? "Retry" : "Refresh"}
      </Button>
    </div>
    <p className="mb-3 text-xs text-muted-foreground">Export local retained data, or retrieve a paused or closed session’s cloud snapshot. Cloud recovery requires current membership and an available session key.</p>
    <div className="mb-3 flex items-center gap-2">
      <Input aria-label="Session ID for cloud recovery" placeholder="Session ID (czs_…)" value={cloudSessionId}
        onChange={(event) => setCloudSessionId(event.target.value.trim())} disabled={busy} />
      <Button variant="outline" size="sm" disabled={busy || !/^czs_[a-f0-9]{16}$/.test(cloudSessionId)}
        onClick={() => { void exportEntry({ publicSessionId: cloudSessionId }, "cloud") }}>Recover from cloud</Button>
    </div>
    <p className="mb-3 text-xs text-muted-foreground">Have the key on this device? Share recovery keys lets existing authorized members recover a paused or closed session.</p>
    <Button className="mb-3" variant="outline" size="sm" disabled={busy || !/^czs_[a-f0-9]{16}$/.test(cloudSessionId)}
      onClick={() => { void shareKeys(cloudSessionId) }}>{sharing ? "Sharing…" : "Share recovery keys"}</Button>
    {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="mb-3 break-words text-sm">{notice}</p>}
    {!loading && !error && projectEntries.length === 0 && <p className="text-sm text-muted-foreground">No local recovery records for this project.</p>}
    {projectEntries.length > 0 && <SettingsGroup>
      {projectEntries.map((entry, index) => <SettingsRow key={entry.publicSessionId} isFirst={index === 0}>
        <SettingsRowLabel title={entry.branchName ?? entry.publicSessionId}
          description={`${entry.publicSessionId} — ${recoveryDescription(entry)}`} />
        <SettingsRowControl><Button variant="outline" size="sm"
          disabled={busy || !entry.hasRetainedKey || (entry.snapshotSequence === null && entry.pendingBatches === 0 && entry.pendingBinaryVersions === 0)}
          onClick={() => { void exportEntry(entry) }}>
          {exporting === entry.publicSessionId ? "Exporting…" : "Export retained files"}
        </Button>
          <Button variant="outline" size="sm" disabled={busy}
            onClick={() => { void exportEntry(entry, "cloud") }}>Export cloud snapshot</Button>
        </SettingsRowControl>
      </SettingsRow>)}
    </SettingsGroup>}
    {unreadable.length > 0 && <div className="mt-4">
      <p className="mb-2 text-xs text-muted-foreground">These unreadable records could not be assigned to a project.</p>
      <SettingsGroup>{unreadable.map((entry, index) => <SettingsRow key={entry.publicSessionId} isFirst={index === 0}>
        <SettingsRowLabel title={entry.publicSessionId} description={recoveryDescription(entry)} />
      </SettingsRow>)}</SettingsGroup>
    </div>}
  </section>
}
