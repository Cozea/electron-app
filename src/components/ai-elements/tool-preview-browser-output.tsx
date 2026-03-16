"use client"

import { useMemo, useState } from 'react'
import {
  CameraIcon,
  CheckIcon,
  Clock3Icon,
  CopyIcon,
  GlobeIcon,
  ImageIcon,
  KeyboardIcon,
  LinkIcon,
  MousePointer2Icon,
  NavigationIcon,
  SearchIcon,
  TypeIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ai-elements/code-block'
import { cn } from '@/lib/utils'

type PreviewBrowserState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'

interface PreviewBrowserOutputProps {
  input?: Record<string, unknown>
  output?: unknown
  state?: PreviewBrowserState
  className?: string
}

interface PreviewBrowserPayload {
  action: string
  url?: string
  path?: string
  snapshot?: unknown
  result?: unknown
  ref?: string
  element?: string
  text?: string
  key?: string
}

interface PreviewActionMeta {
  label: string
  icon: typeof GlobeIcon
}

interface SnapshotRow {
  ref?: string
  role?: string
  name?: string
  text?: string
  raw?: string
}

const ACTION_META: Record<string, PreviewActionMeta> = {
  click: { label: 'Tried page', icon: MousePointer2Icon },
  navigate: { label: 'Opened page', icon: NavigationIcon },
  press: { label: 'Pressed key', icon: KeyboardIcon },
  screenshot: { label: 'Took screenshot', icon: CameraIcon },
  snapshot: { label: 'Looked at page', icon: SearchIcon },
  type: { label: 'Typed on page', icon: KeyboardIcon },
  wait_for: { label: 'Waited', icon: Clock3Icon },
}

const MAX_SNAPSHOT_ROWS = 80
const DISPLAY_ROW_LIMIT = 12

function parsePreviewBrowserPayload(
  input: Record<string, unknown> | undefined,
  output: unknown
): PreviewBrowserPayload {
  const baseInput = isRecord(input) ? input : {}
  const parsedOutput = parseUnknownPayload(output)
  const baseOutput = isRecord(parsedOutput) ? parsedOutput : {}

  return {
    action: getString(baseOutput.action) ?? getString(baseInput.action) ?? 'snapshot',
    url: getString(baseOutput.url) ?? getString(baseInput.url) ?? getString(baseInput.currentUrl),
    path: getString(baseInput.path),
    snapshot: baseOutput.snapshot,
    result: Object.prototype.hasOwnProperty.call(baseOutput, 'result') ? baseOutput.result : undefined,
    ref: getString(baseInput.ref),
    element: getString(baseInput.element),
    text: getString(baseInput.text),
    key: getString(baseInput.key),
  }
}

function parseUnknownPayload(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed.length === 0) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getActionMeta(action: string): PreviewActionMeta {
  return ACTION_META[action] ?? { label: 'Checked page', icon: GlobeIcon }
}

function formatPreviewLocation(url?: string, path?: string): { route: string; host?: string } {
  if (path && path.trim().length > 0) {
    return { route: path.trim(), host: 'localhost' }
  }

  if (!url) return { route: '/' }

  try {
    const parsed = new URL(url)
    const route = `${parsed.pathname || '/'}${parsed.search || ''}`
    return {
      route: route || '/',
      host: parsed.host,
    }
  } catch {
    return { route: url }
  }
}

function buildActionSummary(payload: PreviewBrowserPayload): string {
  const location = formatPreviewLocation(payload.url, payload.path).route
  switch (payload.action) {
    case 'snapshot':
      return `Took a quick look at ${location}.`
    case 'navigate':
      return `Opened ${location} in the preview.`
    case 'click':
      return payload.element
        ? `Tried clicking ${payload.element} on ${location}.`
        : `Tried clicking something on ${location}.`
    case 'type':
      return payload.element
        ? `Typed into ${payload.element} on ${location}.`
        : payload.text
          ? `Entered text on ${location}.`
          : `Typed on ${location}.`
    case 'press':
      return payload.key
        ? `Pressed ${payload.key} on ${location}.`
        : `Pressed a key on ${location}.`
    case 'wait_for':
      return `Waited for ${location} to settle.`
    case 'screenshot':
      return `Took a screenshot of ${location}.`
    default:
      return `Checked ${location} in the preview.`
  }
}

function extractResultSummary(result: unknown): string | null {
  if (typeof result === 'string') {
    const trimmed = result.trim()
    if (!trimmed) return null
    return trimmed.split(/\r?\n/g).find((line) => line.trim().length > 0)?.trim() ?? trimmed
  }

  if (Array.isArray(result)) {
    const first = result.find((entry) => entry !== null && entry !== undefined)
    return extractResultSummary(first)
  }

  if (!isRecord(result)) return null

  const preferredFields = ['message', 'summary', 'result', 'text', 'description', 'filename', 'path']
  for (const field of preferredFields) {
    const value = getString(result[field])
    if (value) return value
  }

  return null
}

function normalizeSnapshotRows(snapshot: unknown): SnapshotRow[] {
  if (typeof snapshot === 'string') {
    return normalizeSnapshotText(snapshot)
  }
  if (Array.isArray(snapshot) || isRecord(snapshot)) {
    return normalizeStructuredSnapshot(snapshot)
  }
  return []
}

function normalizeSnapshotText(snapshot: string): SnapshotRow[] {
  const lines = snapshot
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)

  const rows: SnapshotRow[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (
      !trimmed.startsWith('-') &&
      !trimmed.startsWith('*') &&
      !trimmed.includes('[ref=') &&
      !trimmed.includes('text:')
    ) {
      continue
    }

    const refMatch = trimmed.match(/\[ref=([^\]]+)\]/i)
    const quotedMatch = trimmed.match(/"([^"]+)"/)
    const roleMatch = trimmed.match(/^[-*]\s*([^"[{:]+)/)
    const textMatch = trimmed.match(/:\s*(.+)$/)
    rows.push({
      ref: refMatch?.[1]?.trim(),
      role: roleMatch?.[1]?.trim(),
      name: quotedMatch?.[1]?.trim(),
      text: textMatch?.[1]?.trim(),
      raw: trimmed,
    })
    if (rows.length >= MAX_SNAPSHOT_ROWS) break
  }

  return dedupeRows(rows)
}

function normalizeStructuredSnapshot(snapshot: unknown): SnapshotRow[] {
  const rows: SnapshotRow[] = []
  const seen = new Set<unknown>()

  const visit = (value: unknown) => {
    if (!value || rows.length >= MAX_SNAPSHOT_ROWS) return

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item)
        if (rows.length >= MAX_SNAPSHOT_ROWS) return
      }
      return
    }

    if (!isRecord(value) || seen.has(value)) return
    seen.add(value)

    const row = extractStructuredRow(value)
    if (row) {
      rows.push(row)
      if (rows.length >= MAX_SNAPSHOT_ROWS) return
    }

    for (const child of Object.values(value)) {
      visit(child)
      if (rows.length >= MAX_SNAPSHOT_ROWS) return
    }
  }

  visit(snapshot)
  return dedupeRows(rows)
}

function extractStructuredRow(record: Record<string, unknown>): SnapshotRow | null {
  const ref = getString(record.ref) ?? getString(record.id)
  const role = getString(record.role) ?? getString(record.tag) ?? getString(record.type)
  const name =
    getString(record.accessibleName) ??
    getString(record.name) ??
    getString(record.label) ??
    getString(record.title)
  const text =
    getString(record.text) ??
    getString(record.value) ??
    getString(record.description) ??
    getString(record.content)

  if (!ref && !role && !name && !text) return null

  return {
    ref,
    role,
    name,
    text,
  }
}

function dedupeRows(rows: SnapshotRow[]): SnapshotRow[] {
  const seen = new Set<string>()
  return rows
    .filter((row) => {
      const key = [row.ref, row.role, row.name, row.text, row.raw].join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => scoreSnapshotRow(left) - scoreSnapshotRow(right))
}

function scoreSnapshotRow(row: SnapshotRow): number {
  const role = normalizeRole(row.role)
  if (role === 'button') return 0
  if (role === 'link') return 1
  if (role === 'searchbox' || role === 'textbox' || role === 'combobox') return 2
  if (role === 'heading') return 3
  if (role === 'checkbox' || role === 'switch' || role === 'radio' || role === 'tab') return 4
  if (row.name) return 5
  if (row.text) return 6
  return 7
}

function normalizeRole(role?: string): string {
  return role?.trim().toLowerCase() ?? ''
}

function formatRoleLabel(role?: string): string | null {
  switch (normalizeRole(role)) {
    case 'button':
      return 'Button'
    case 'link':
      return 'Link'
    case 'textbox':
    case 'searchbox':
    case 'combobox':
      return 'Text field'
    case 'heading':
      return 'Heading'
    case 'checkbox':
      return 'Checkbox'
    case 'switch':
      return 'Switch'
    case 'radio':
      return 'Choice'
    case 'tab':
      return 'Tab'
    case 'image':
    case 'img':
      return 'Image'
    case 'text':
      return 'Text'
    case 'navigation':
      return 'Navigation'
    case 'menuitem':
      return 'Menu item'
    default: {
      const normalized = normalizeRole(role)
      if (!normalized) return null
      return normalized
        .split(/[\s_-]+/g)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    }
  }
}

function getSnapshotRowIcon(role?: string) {
  switch (normalizeRole(role)) {
    case 'button':
      return MousePointer2Icon
    case 'link':
      return LinkIcon
    case 'textbox':
    case 'searchbox':
    case 'combobox':
      return TypeIcon
    case 'image':
    case 'img':
      return ImageIcon
    case 'heading':
      return NavigationIcon
    default:
      return GlobeIcon
  }
}

function getSnapshotRowTitle(row: SnapshotRow): string {
  const title = row.name?.trim() || row.text?.trim()
  if (title) return title
  return formatRoleLabel(row.role) ?? 'Page item'
}

function getSnapshotRowDetail(row: SnapshotRow): string | null {
  const roleLabel = formatRoleLabel(row.role)
  const text = row.text?.trim()
  if (roleLabel && text && row.name && text !== row.name) {
    return `${roleLabel} · ${text}`
  }
  if (roleLabel && !row.name) return roleLabel
  if (roleLabel) return roleLabel
  if (text && text !== row.name) return text
  if (row.raw) return row.raw
  return null
}

function buildPageReadingSummary(rows: SnapshotRow[]): string | null {
  if (rows.length === 0) return null

  const buttons = rows.filter((row) => normalizeRole(row.role) === 'button').length
  const links = rows.filter((row) => normalizeRole(row.role) === 'link').length
  const inputs = rows.filter((row) => ['textbox', 'searchbox', 'combobox'].includes(normalizeRole(row.role))).length
  const parts: string[] = []

  if (buttons > 0) parts.push(`${buttons} button${buttons === 1 ? '' : 's'}`)
  if (links > 0) parts.push(`${links} link${links === 1 ? '' : 's'}`)
  if (inputs > 0) parts.push(`${inputs} field${inputs === 1 ? '' : 's'}`)

  if (parts.length === 0) {
    return `It picked up ${rows.length} visible item${rows.length === 1 ? '' : 's'} on the page.`
  }

  return `It picked up ${parts.join(', ')} on the page.`
}

function formatResultDetail(result: unknown): string | null {
  const summary = extractResultSummary(result)
  if (!summary) return null

  return summary
    .replace(/^navigated to\s+/i, 'Opened ')
    .replace(/^clicked\s+/i, 'Clicked ')
    .replace(/^typed\s+/i, 'Typed ')
    .replace(/^waited\s+/i, 'Waited ')
}

function buildCopyPayload(payload: PreviewBrowserPayload, output: unknown): string {
  if (typeof payload.snapshot === 'string' && payload.snapshot.trim().length > 0) {
    return payload.snapshot
  }
  if (payload.snapshot !== undefined) {
    return JSON.stringify(payload.snapshot, null, 2)
  }
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

export function ToolPreviewBrowserOutput({
  input,
  output,
  state = 'output-available',
  className,
}: PreviewBrowserOutputProps) {
  const [isCopied, setIsCopied] = useState(false)
  const payload = useMemo(() => parsePreviewBrowserPayload(input, output), [input, output])
  const actionMeta = useMemo(() => getActionMeta(payload.action), [payload.action])
  const location = useMemo(
    () => formatPreviewLocation(payload.url, payload.path),
    [payload.path, payload.url]
  )
  const snapshotRows = useMemo(
    () => normalizeSnapshotRows(payload.snapshot),
    [payload.snapshot]
  )
  const resultSummary = useMemo(
    () => formatResultDetail(payload.result),
    [payload.result]
  )
  const visibleRows = useMemo(
    () => snapshotRows.slice(0, DISPLAY_ROW_LIMIT),
    [snapshotRows]
  )
  const hiddenRowCount = Math.max(snapshotRows.length - visibleRows.length, 0)
  const pageReadingSummary = useMemo(
    () => buildPageReadingSummary(snapshotRows),
    [snapshotRows]
  )
  const copyPayload = useMemo(
    () => buildCopyPayload(payload, output),
    [output, payload]
  )
  const rawSnapshot =
    typeof payload.snapshot === 'string'
      ? payload.snapshot
      : payload.snapshot !== undefined
        ? JSON.stringify(payload.snapshot, null, 2)
        : null

  const ActionIcon = actionMeta.icon

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyPayload)
      setIsCopied(true)
      window.setTimeout(() => setIsCopied(false), 2000)
    } catch {
      // Ignore copy errors.
    }
  }

  return (
    <div
      className={cn(
        'group relative w-full overflow-hidden rounded-2xl bg-[var(--tool-surface)] text-[var(--tool-surface-foreground)]',
        className
      )}
    >
      <div className="flex min-h-8 items-center justify-between gap-2 px-3 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-medium dark:bg-white/[0.06]">
            <ActionIcon className="h-3 w-3" />
            {actionMeta.label}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px] text-muted-foreground">
              {location.route}
              {location.host ? (
                <span className="ml-1 text-muted-foreground/70">@ {location.host}</span>
              ) : null}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          onClick={() => void handleCopy()}
          title="Copy preview data"
        >
          {isCopied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
        </Button>
      </div>

      <div className="relative max-h-64 overflow-hidden px-3 pb-3 pt-2">
        <div
          className="pointer-events-none absolute inset-x-3 top-2 z-10 h-5"
          style={{ background: 'linear-gradient(to bottom, var(--tool-surface), transparent)' }}
        />
        <div className="app-scrollbar relative max-h-[236px] overflow-y-auto">
          <div className="space-y-3 pr-1">
            <div className="rounded-xl border border-border/40 bg-black/[0.02] px-3 py-2 dark:bg-white/[0.03]">
              <p className="text-sm font-medium leading-5">
                {resultSummary ?? buildActionSummary(payload)}
              </p>
              {pageReadingSummary ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {pageReadingSummary}
                </p>
              ) : null}
            </div>

            {visibleRows.length > 0 ? (
              <div className="space-y-2">
                <div className="px-1 text-xs font-medium text-muted-foreground">
                  What was on the page
                </div>
                {visibleRows.map((row, index) => {
                  const RowIcon = getSnapshotRowIcon(row.role)
                  const title = getSnapshotRowTitle(row)
                  const detail = getSnapshotRowDetail(row)
                  return (
                  <div
                    key={`${row.ref ?? 'row'}-${index}`}
                    className="flex items-start gap-3 rounded-xl border border-border/35 bg-black/[0.02] px-3 py-2 dark:bg-white/[0.02]"
                  >
                    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-muted-foreground dark:bg-white/[0.06]">
                      <RowIcon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 space-y-1">
                      <p className="line-clamp-2 text-sm font-medium leading-5">
                        {title}
                      </p>
                      {detail ? (
                        <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {detail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )})}
                {hiddenRowCount > 0 ? (
                  <div className="px-1 text-xs text-muted-foreground">
                    And {hiddenRowCount} more item{hiddenRowCount === 1 ? '' : 's'} on the page.
                  </div>
                ) : null}
              </div>
            ) : rawSnapshot ? (
              <CodeBlock
                code={rawSnapshot}
                language="text"
                className="[--codeblock-surface:var(--tool-surface)] [--codeblock-foreground:var(--tool-surface-foreground)] border-0"
              />
            ) : payload.result !== undefined ? (
              <CodeBlock
                code={
                  typeof payload.result === 'string'
                    ? payload.result
                    : JSON.stringify(payload.result, null, 2)
                }
                language="json"
                className="[--codeblock-surface:var(--tool-surface)] [--codeblock-foreground:var(--tool-surface-foreground)] border-0"
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border/50 px-3 py-4 text-sm text-muted-foreground">
                {state === 'output-available'
                  ? 'No page details came back yet.'
                  : 'Checking the page now.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
