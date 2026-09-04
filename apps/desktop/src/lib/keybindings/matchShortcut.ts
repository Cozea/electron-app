import type {
  KeybindingCommand,
  KeybindingShortcut,
  KeybindingWhenNode,
  ResolvedKeybindingsConfig,
} from "@cozea/assistant-contracts"

import { isMacPlatform } from "@/features/assistant/lib/utils"

export interface ShortcutEventLike {
  type?: string
  code?: string
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export interface ShortcutMatchContext {
  terminalFocus: boolean
  terminalOpen: boolean
  previewFocus: boolean
  previewOpen: boolean
  [key: string]: boolean
}

export interface ShortcutMatchOptions {
  platform?: string
  context?: Partial<ShortcutMatchContext>
}

function normalizeEventKey(key: string): string {
  const normalized = key.toLowerCase()
  if (normalized === "esc") return "escape"
  return normalized
}

function matchesShortcutModifiers(
  event: Pick<ShortcutEventLike, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  shortcut: KeybindingShortcut,
  platform: string,
): boolean {
  const useMetaForMod = isMacPlatform(platform)
  const expectedMeta = shortcut.metaKey || (shortcut.modKey && useMetaForMod)
  const expectedCtrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod)
  return (
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
    event.shiftKey === shortcut.shiftKey &&
    event.altKey === shortcut.altKey
  )
}

function matchesShortcut(
  event: ShortcutEventLike,
  shortcut: KeybindingShortcut,
  platform: string,
): boolean {
  if (!matchesShortcutModifiers(event, shortcut, platform)) return false
  return normalizeEventKey(event.key) === shortcut.key
}

function resolvePlatform(options: ShortcutMatchOptions | undefined): string {
  if (options?.platform) return options.platform
  if (typeof navigator !== "undefined") return navigator.platform
  return "Linux"
}

function resolveContext(options: ShortcutMatchOptions | undefined): ShortcutMatchContext {
  return {
    terminalFocus: false,
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    ...options?.context,
  }
}

function evaluateWhenNode(node: KeybindingWhenNode, context: ShortcutMatchContext): boolean {
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true
      if (node.name === "false") return false
      return Boolean(context[node.name])
    case "not":
      return !evaluateWhenNode(node.node, context)
    case "and":
      return evaluateWhenNode(node.left, context) && evaluateWhenNode(node.right, context)
    case "or":
      return evaluateWhenNode(node.left, context) || evaluateWhenNode(node.right, context)
  }
}

function matchesWhenClause(
  whenAst: KeybindingWhenNode | undefined,
  context: ShortcutMatchContext,
): boolean {
  if (!whenAst) return true
  return evaluateWhenNode(whenAst, context)
}

export function resolveShortcutCommand(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  options?: ShortcutMatchOptions,
): KeybindingCommand | null {
  const platform = resolvePlatform(options)
  const context = resolveContext(options)

  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index]
    if (!binding) continue
    if (!matchesWhenClause(binding.whenAst, context)) continue
    if (!matchesShortcut(event, binding.shortcut, platform)) continue
    return binding.command
  }
  return null
}

export function findShortcutForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): KeybindingShortcut | null {
  const context = resolveContext(options)

  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index]
    if (!binding) continue
    if (binding.command !== command) continue
    if (!matchesWhenClause(binding.whenAst, context)) continue
    return binding.shortcut
  }
  return null
}

function formatShortcutKeyLabel(key: string): string {
  if (key === " ") return "Space"
  if (key.length === 1) return key.toUpperCase()
  if (key === "escape") return "Esc"
  if (key === "arrowup") return "Up"
  if (key === "arrowdown") return "Down"
  if (key === "arrowleft") return "Left"
  if (key === "arrowright") return "Right"
  return key.slice(0, 1).toUpperCase() + key.slice(1)
}

export function formatShortcutLabel(
  shortcut: KeybindingShortcut,
  platform?: string,
): string {
  const resolvedPlatform = platform ?? resolvePlatform(undefined)
  const keyLabel = formatShortcutKeyLabel(shortcut.key)
  const useMetaForMod = isMacPlatform(resolvedPlatform)
  const showMeta = shortcut.metaKey || (shortcut.modKey && useMetaForMod)
  const showCtrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod)
  const showAlt = shortcut.altKey
  const showShift = shortcut.shiftKey

  if (useMetaForMod) {
    return `${showCtrl ? "\u2303" : ""}${showAlt ? "\u2325" : ""}${showShift ? "\u21e7" : ""}${showMeta ? "\u2318" : ""}${keyLabel}`
  }

  const parts: string[] = []
  if (showCtrl) parts.push("Ctrl")
  if (showAlt) parts.push("Alt")
  if (showShift) parts.push("Shift")
  if (showMeta) parts.push("Meta")
  parts.push(keyLabel)
  return parts.join("+")
}

export function shortcutLabelForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  options?: ShortcutMatchOptions,
): string | null {
  const shortcut = findShortcutForCommand(keybindings, command, options)
  if (!shortcut) return null
  return formatShortcutLabel(shortcut, resolvePlatform(options))
}

export function isTerminalElementFocused(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest(".xterm") || target.closest("[data-terminal-focus='true']"))
}
