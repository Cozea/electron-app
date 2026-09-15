import { describe, expect, it } from 'vitest'
import type { AvailableExternalEditor, ExternalEditorId } from '@shared/electronApiTypes'
import {
  orderDetectedEditors,
  resolvePreferredExternalEditorId,
  T3_STYLE_EDITOR_ORDER,
} from '@/features/settings/model/externalEditorPreference'
import {
  getExternalEditorIcon,
  getExternalEditorKind,
  GenericCodeIcon,
} from '@/features/settings/model/externalEditorIcons'
import {
  CLIENT_FALLBACK_KEYBINDINGS,
} from '@/lib/keybindings/defaults'
import {
  formatShortcutLabel,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from '@/lib/keybindings/matchShortcut'

describe('OpenInPicker editor ordering & preferences', () => {
  it('orders detected editors according to T3 Code order', () => {
    const editors: AvailableExternalEditor[] = [
      { id: 'zed', name: 'Zed' },
      { id: 'cursor', name: 'Cursor' },
      { id: 'vscode', name: 'VS Code' },
    ]

    const ordered = orderDetectedEditors(editors)
    expect(ordered.map((e) => e.id)).toEqual(['cursor', 'vscode', 'zed'])
  })

  it('places known editors before unknown custom editors', () => {
    const editors = [
      { id: 'custom-editor' as ExternalEditorId, name: 'Custom Editor' },
      { id: 'vscode' as ExternalEditorId, name: 'VS Code' },
      { id: 'antigravity' as ExternalEditorId, name: 'Antigravity' },
    ]

    const ordered = orderDetectedEditors(editors)
    expect(ordered.map((e) => e.id)).toEqual(['vscode', 'antigravity', 'custom-editor'])
  })

  it('handles empty editor list', () => {
    expect(orderDetectedEditors([])).toEqual([])
  })

  it('resolves preferred editor when stored preference exists', () => {
    const editors: AvailableExternalEditor[] = [
      { id: 'vscode', name: 'VS Code' },
      { id: 'cursor', name: 'Cursor' },
    ]

    expect(resolvePreferredExternalEditorId(editors, 'cursor')).toBe('cursor')
    expect(resolvePreferredExternalEditorId(editors, 'vscode')).toBe('vscode')
  })

  it('falls back to first detected editor when stored preference is missing or not installed', () => {
    const editors: AvailableExternalEditor[] = [
      { id: 'cursor', name: 'Cursor' },
      { id: 'vscode', name: 'VS Code' },
    ]

    expect(resolvePreferredExternalEditorId(editors, null)).toBe('cursor')
    expect(resolvePreferredExternalEditorId(editors, 'zed')).toBe('cursor')
    expect(resolvePreferredExternalEditorId([], 'vscode')).toBeNull()
  })
})

describe('External editor icon mappings', () => {
  it('returns appropriate icon and kind for brand editors', () => {
    expect(getExternalEditorKind('cursor')).toBe('brand')
    expect(getExternalEditorKind('vscode')).toBe('brand')
    expect(getExternalEditorKind('zed')).toBe('brand')
    expect(getExternalEditorKind('antigravity')).toBe('brand')
    expect(getExternalEditorKind('finder')).toBe('generic')

    expect(getExternalEditorIcon('cursor')).toBeDefined()
    expect(getExternalEditorIcon('vscode')).toBeDefined()
    expect(getExternalEditorIcon('finder')).toBeDefined()
    expect(getExternalEditorIcon('unknown' as ExternalEditorId)).toBe(GenericCodeIcon)
  })
})

describe('OpenInPicker shortcut integration', () => {
  it('resolves editor.openFavorite command for mod+o shortcut', () => {
    const macEvent = {
      key: 'o',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    }

    const command = resolveShortcutCommand(macEvent, CLIENT_FALLBACK_KEYBINDINGS, {
      platform: 'MacIntel',
    })
    expect(command).toBe('editor.openFavorite')
  })

  it('formats open favorite editor shortcut label correctly for macOS and other platforms', () => {
    const macLabel = shortcutLabelForCommand(CLIENT_FALLBACK_KEYBINDINGS, 'editor.openFavorite', {
      platform: 'MacIntel',
    })
    expect(macLabel).toBe('\u2318O')

    const winLabel = shortcutLabelForCommand(CLIENT_FALLBACK_KEYBINDINGS, 'editor.openFavorite', {
      platform: 'Win32',
    })
    expect(winLabel).toBe('Ctrl+O')
  })
})
