import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { isDeviceIdentityKey, normalizeDeviceIdentityKey } from "@shared/deviceIdentity"
import { DeviceAvatar } from "@/components/ui/DeviceAvatar"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/combobox"

const capacityMessage = (limit: number) =>
  limit <= 0
    ? "This project is full. Remove someone, or cancel a pending invitation, to invite more."
    : `You can invite ${limit} more ${limit === 1 ? "device" : "devices"} to this project.`

/** A device picked for invitation. The key is what the enrollment is written against. */
export interface InviteTarget {
  identityKey: string
  displayName: string
  avatarUrl: string | null
  principalId: string | null
  /** Projects and groups this device is already known from. Absent on a pasted key. */
  knownFrom?: string[]
}

/**
 * Recipient field for project invitations, in the shape of an email "To:" row:
 * pick people this device shares a group with by name, or paste a czd_ device ID
 * and press Enter. Each accepted recipient becomes a chip; nothing is sent until
 * the caller submits.
 */
export function InviteDevicesField({
  projectId,
  value,
  onChange,
  disabled,
  maxTargets,
  endAddon,
}: {
  projectId: Id<"projects">
  value: InviteTarget[]
  onChange: (next: InviteTarget[]) => void
  disabled?: boolean
  /** Seats left on the project. The field stops accepting recipients at this many. */
  maxTargets: number
  /** Rendered inside the field at its right end, e.g. the send control. */
  endAddon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const candidates = useQuery(api.projectDeviceEnrollments.listInviteCandidates, { projectId })

  // Only a complete key is worth resolving; anything shorter is a name search.
  const typedKey = normalizeDeviceIdentityKey(inputValue)
  const typedIsKey = isDeviceIdentityKey(typedKey)
  const resolved = useQuery(
    api.projectDeviceEnrollments.resolveIdentityKey,
    typedIsKey ? { projectId, identityKey: typedKey } : "skip",
  )

  const chosen = useMemo(() => new Set(value.map((target) => target.identityKey)), [value])
  const items = useMemo<InviteTarget[]>(
    () =>
      (candidates ?? [])
        .filter((candidate) => !chosen.has(candidate.identityKey))
        .map((candidate) => ({
          identityKey: candidate.identityKey,
          displayName: candidate.displayName,
          avatarUrl: candidate.avatarUrl,
          principalId: String(candidate.principalId),
          knownFrom: candidate.knownFrom,
        })),
    [candidates, chosen],
  )

  const atCapacity = value.length >= maxTargets

  const add = (target: InviteTarget) => {
    setInputValue("")
    setError(null)
    if (chosen.has(target.identityKey)) return
    if (atCapacity) {
      setError(capacityMessage(maxTargets))
      return
    }
    onChange([...value, target])
  }

  const commitResolved = (resolution: NonNullable<typeof resolved>) => {
    if (resolution.status === "ok") {
      add({
        identityKey: resolution.identityKey,
        displayName: resolution.displayName ?? resolution.identityKey,
        avatarUrl: resolution.avatarUrl,
        principalId: resolution.principalId ? String(resolution.principalId) : null,
      })
      return
    }
    setError(
      resolution.status === "member"
        ? `${resolution.displayName ?? "That device"} already has access.`
        : resolution.status === "unknown"
          ? "No Cozea device has that ID yet."
          : "Enter a full czd_ device ID.",
    )
  }

  // Enter can land before the resolver answers; hold the key and commit when it does.
  useEffect(() => {
    if (!pendingKey || !resolved || resolved.identityKey !== pendingKey) return
    setPendingKey(null)
    commitResolved(resolved)
    // commitResolved closes over the current chips; listing it here would loop.
  }, [pendingKey, resolved]) // eslint-disable-line

  const handleEnter = () => {
    const typed = inputValue.trim()
    if (!typed) return
    if (!typedIsKey) {
      // A name query is the list's business; only a czd_ fragment is worth a word.
      if (typed.toLowerCase().startsWith("czd_")) setError("That device ID is incomplete.")
      return
    }
    if (!resolved) {
      setPendingKey(typedKey)
      return
    }
    commitResolved(resolved)
  }

  return (
    <div className="space-y-1.5">
      <Combobox
        multiple
        items={items}
        open={open}
        onOpenChange={setOpen}
        value={value}
        disabled={disabled}
        inputValue={inputValue}
        onInputValueChange={(next) => {
          setInputValue(next)
          if (error) setError(null)
        }}
        openOnInputClick
        itemToStringLabel={(item) => item.displayName}
        filter={(item, query) => {
          const needle = query.trim().toLowerCase()
          if (!needle) return true
          // Name or device ID: the ID is how someone arrives from outside a shared group.
          return (
            item.displayName.toLowerCase().includes(needle) ||
            item.identityKey.toLowerCase().includes(needle)
          )
        }}
        isItemEqualToValue={(item, candidate) => item.identityKey === candidate.identityKey}
        onValueChange={(next) => {
          if (next.length > maxTargets) {
            setError(capacityMessage(maxTargets))
            return
          }
          onChange(next)
          setInputValue("")
          setError(null)
        }}
      >
        <ComboboxChips className="min-h-9 items-center py-1 sm:min-h-9 [&>*]:h-7">
          {value.map((target) => (
            <ComboboxChip key={target.identityKey} aria-label={target.displayName}>
              <DeviceAvatar
                displayName={target.displayName}
                avatarUrl={target.avatarUrl}
                principalId={target.principalId}
                className="-ms-1 me-1.5 size-4"
                fallbackClassName="text-[8px] font-medium"
              />
              {target.displayName}
            </ComboboxChip>
          ))}
          <ComboboxChipsInput
            disabled={atCapacity}
            placeholder={
              atCapacity ? "" : value.length === 0 ? "Add people by name or device ID" : ""
            }
            aria-label="People to invite"
            // Focus alone shows who is available, the way a mail client offers recents.
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              // A highlighted suggestion is the list's to commit; a typed key is ours.
              if (!inputValue.trim().toLowerCase().startsWith("czd_")) return
              event.preventDefault()
              handleEnter()
            }}
          />
          {endAddon ? <div className="ms-auto flex h-7 shrink-0 items-center">{endAddon}</div> : null}
        </ComboboxChips>

        <ComboboxPopup>
          <ComboboxList>
            {(item: InviteTarget) => (
              <ComboboxItem key={item.identityKey} value={item} hideIndicator>
                <div className="flex items-center gap-2.5 py-0.5">
                  <DeviceAvatar
                    displayName={item.displayName}
                    avatarUrl={item.avatarUrl}
                    principalId={item.principalId}
                    className="size-7"
                    fallbackClassName="text-caption font-medium"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{item.displayName}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{item.identityKey}</p>
                  </div>
                  {item.knownFrom && item.knownFrom.length > 0 ? (
                    <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground/80">
                      {item.knownFrom[0]}
                    </span>
                  ) : null}
                </div>
              </ComboboxItem>
            )}
          </ComboboxList>
          <ComboboxEmpty>
            {candidates === undefined
              ? "Loading…"
              : typedIsKey
                ? "Press Enter to invite that device ID."
                : "Nobody matches. Paste a czd_ device ID to invite a device directly."}
          </ComboboxEmpty>
        </ComboboxPopup>
      </Combobox>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : atCapacity ? (
        <p className="text-xs text-muted-foreground">{capacityMessage(maxTargets)}</p>
      ) : null}
    </div>
  )
}
